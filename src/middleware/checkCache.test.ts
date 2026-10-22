import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { fakeRequest, fakeResponse } from "../testing/fakeExpress"
import { createFakeRedis } from "../testing/fakeRedis"
import { checkCache } from "./checkCache"

const URL = "/v1/gen/1"
const OK = { ok: true }

// Runs checkCache, then (when it passes the request on) a handler that
// answers with `status` and `body`, the way a controller would.
const serve = async (
  client: ReturnType<typeof createFakeRedis>["client"],
  status: number,
  body: unknown,
) => {
  const { res, sent } = fakeResponse({ client })
  let reachedHandler = false
  await checkCache(fakeRequest({ originalUrl: URL }), res, () => {
    reachedHandler = true
    res.status(status).json(body)
  })
  // The cache write is fire-and-forget; let it land.
  await new Promise((resolve) => setImmediate(resolve))
  return { sent, reachedHandler }
}

describe("checkCache", () => {
  it("stores a 200 under a namespaced key and replays it verbatim", async () => {
    const fake = createFakeRedis()

    const miss = await serve(fake.client, 200, OK)
    assert.equal(miss.reachedHandler, true)
    assert.equal(miss.sent.body, '{"ok":true}')
    assert.equal(miss.sent.type, "application/json")
    assert.equal(fake.strings.get(`cache:${URL}`), '{"ok":true}')

    const hit = await serve(fake.client, 200, { ok: false })
    assert.equal(hit.reachedHandler, false)
    assert.equal(hit.sent.body, '{"ok":true}')
    assert.equal(hit.sent.type, "application/json")
  })

  it("does not cache other statuses", async () => {
    const fake = createFakeRedis()

    await serve(fake.client, 404, { error: "Chapter not found" })

    assert.equal(fake.strings.size, 0)
  })

  it("hands an undefined body to the original json()", async () => {
    const fake = createFakeRedis()

    const { sent } = await serve(fake.client, 200, undefined)

    assert.equal(sent.body, undefined)
    assert.equal(fake.strings.size, 0)
  })

  it("still serves the response when the cache write fails", async () => {
    const fake = createFakeRedis()
    Object.assign(fake.client, {
      set: async () => {
        throw new Error("OOM")
      },
    })

    const { sent } = await serve(fake.client, 200, OK)

    assert.equal(sent.body, '{"ok":true}')
  })

  it("passes the request on when the cache cannot be read", async () => {
    const fake = createFakeRedis()
    Object.assign(fake.client, {
      get: async () => {
        throw new Error("connection lost")
      },
    })

    const { reachedHandler } = await serve(fake.client, 200, OK)

    assert.equal(reachedHandler, true)
  })
})
