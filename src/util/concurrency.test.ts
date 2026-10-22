import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  createRateLimiter,
  createTaskPool,
  mapWithConcurrency,
} from "./concurrency"

const tick = () => new Promise((resolve) => setImmediate(resolve))

describe("mapWithConcurrency", () => {
  it("maps every item in order while keeping at most `limit` in flight", async () => {
    let inFlight = 0
    let peak = 0

    const results = await mapWithConcurrency(
      [1, 2, 3, 4, 5],
      2,
      async (item, index) => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await tick()
        inFlight--
        return `${index}:${item * 10}`
      },
    )

    assert.deepEqual(results, ["0:10", "1:20", "2:30", "3:40", "4:50"])
    assert.equal(peak, 2)
  })

  it("resolves to an empty array for no items", async () => {
    assert.deepEqual(await mapWithConcurrency([], 3, async () => 1), [])
  })

  it("rejects a limit that would start no workers", async () => {
    for (const limit of [0, -1, 1.5, Number.NaN]) {
      await assert.rejects(
        mapWithConcurrency([1], limit, async () => 1),
        RangeError,
      )
    }
  })

  it("rejects with the first error and starts nothing after it", async () => {
    const started: number[] = []

    await assert.rejects(
      mapWithConcurrency([1, 2, 3, 4], 1, async (item) => {
        started.push(item)
        if (item === 2) throw new Error("boom")
        return item
      }),
      /boom/,
    )

    assert.deepEqual(started, [1, 2])
  })
})

describe("createTaskPool", () => {
  it("runs every submitted task with at most `limit` in flight", async () => {
    const pool = createTaskPool(2)
    let inFlight = 0
    let peak = 0
    const done: number[] = []

    for (const n of [1, 2, 3, 4]) {
      pool.submit(async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await tick()
        inFlight--
        done.push(n)
      })
    }
    await pool.drain()

    assert.deepEqual(done.sort(), [1, 2, 3, 4])
    assert.equal(peak, 2)
  })

  it("waits for tasks that submit more work", async () => {
    const pool = createTaskPool(1)
    const done: string[] = []

    pool.submit(async () => {
      await tick()
      pool.submit(async () => {
        await tick()
        done.push("child")
      })
      done.push("parent")
    })
    await pool.drain()

    assert.deepEqual(done, ["parent", "child"])
  })

  it("drains to the first error and drops tasks still queued", async () => {
    const pool = createTaskPool(1)
    const started: number[] = []

    for (const n of [1, 2, 3]) {
      pool.submit(async () => {
        started.push(n)
        if (n === 1) throw new Error("first")
      })
    }

    await assert.rejects(pool.drain(), /first/)
    assert.deepEqual(started, [1])
  })

  it("drains at once when nothing was submitted", async () => {
    await createTaskPool(3).drain()
  })

  it("rejects a limit that would start no workers", () => {
    assert.throws(() => createTaskPool(0), RangeError)
  })
})

describe("createRateLimiter", () => {
  it("spaces consecutive starts at least the interval apart", async () => {
    const wait = createRateLimiter(30)
    const starts: number[] = []

    await Promise.all(
      [1, 2, 3].map(async () => {
        await wait()
        starts.push(Date.now())
      }),
    )

    starts.sort((a, b) => a - b)
    // A few ms of timer slack below the interval.
    assert.ok(starts[1] - starts[0] >= 25, `${starts[1] - starts[0]}ms`)
    assert.ok(starts[2] - starts[1] >= 25, `${starts[2] - starts[1]}ms`)
  })
})
