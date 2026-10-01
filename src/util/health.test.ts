import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildHealth, pingDatabase } from "./health"

const index = { verses: 31102, vectors: 31102 }

describe("pingDatabase", () => {
  it("is false when there is no client yet", async () => {
    assert.equal(await pingDatabase(undefined), false)
  })

  it("is false, without pinging, while the connection is not ready", async () => {
    let pinged = false
    const client = {
      isReady: false,
      ping: async () => {
        pinged = true
      },
    }

    assert.equal(await pingDatabase(client), false)
    assert.equal(pinged, false)
  })

  it("is true when the database answers", async () => {
    const client = { isReady: true, ping: async () => "PONG" }

    assert.equal(await pingDatabase(client), true)
  })

  it("is false when the ping fails", async () => {
    const client = {
      isReady: true,
      ping: async () => {
        throw new Error("Connection closed")
      },
    }

    assert.equal(await pingDatabase(client), false)
  })

  it("is false when the database does not answer in time", async () => {
    const client = { isReady: true, ping: () => new Promise<never>(() => {}) }
    const started = Date.now()

    assert.equal(await pingDatabase(client, 20), false)
    assert.ok(Date.now() - started < 1000)
  })
})

describe("buildHealth", () => {
  it("is healthy once the data is loaded and the database answers", () => {
    assert.deepEqual(buildHealth("ready", true, index), {
      code: 200,
      body: { status: "ready", database: "ok", index },
    })
  })

  it("still serves when only some embeddings are missing", () => {
    const { code, body } = buildHealth("degraded", true, index)

    assert.equal(code, 200)
    assert.equal(body.status, "degraded")
  })

  it("is unhealthy while the data is loading or the import failed", () => {
    assert.equal(buildHealth("loading", true).code, 503)
    assert.equal(buildHealth("failed", true).code, 503)
  })

  it("is unhealthy when the database does not answer, even with data loaded", () => {
    assert.deepEqual(buildHealth("ready", false, index), {
      code: 503,
      body: { status: "ready", database: "unreachable", index },
    })
  })

  it("leaves the index out until there is one", () => {
    assert.deepEqual(buildHealth("loading", true).body, {
      status: "loading",
      database: "ok",
    })
  })
})
