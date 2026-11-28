import assert from "node:assert/strict"
import type { AddressInfo } from "node:net"
import { after, before, describe, it } from "node:test"
import express from "express"
import { createFakeRedis } from "../testing/fakeRedis"
import { validReminderBody as validBody } from "../testing/reminderFixture"
import { setReminderEndpoints } from "./reminders"

const listen = async (app: express.Express) =>
  new Promise<{ server: ReturnType<express.Express["listen"]>; base: string }>(
    (resolve) => {
      const server = app.listen(0, "127.0.0.1", () =>
        resolve({
          server,
          base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/mais365/reminders`,
        }),
      )
    },
  )

const json = (method: string, body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body),
})

describe("reminder routes", () => {
  const fake = createFakeRedis()
  let server: ReturnType<express.Express["listen"]>
  let base: string

  before(async () => {
    const app = express()
    setReminderEndpoints(app, {
      vapid: { subject: "mailto:a@b.c", publicKey: "PUB", privateKey: "PRIV" },
      getClient: async () => fake.client,
    })
    ;({ server, base } = await listen(app))
  })

  after(() => {
    server.close()
  })

  it("serves the public key", async () => {
    const res = await fetch(`${base}/key`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { publicKey: "PUB" })
  })

  it("upserts and deletes, 204 either way", async () => {
    const put = await fetch(base, json("PUT", validBody()))
    assert.equal(put.status, 204)
    assert.equal(fake.sets.get("reminders")?.size, 1)

    const endpoint = validBody().subscription.endpoint
    const del = await fetch(base, json("DELETE", { endpoint }))
    assert.equal(del.status, 204)
    assert.equal(fake.sets.get("reminders")?.size, 0)

    const again = await fetch(base, json("DELETE", { endpoint }))
    assert.equal(again.status, 204)
  })

  it("answers 400 to bad bodies and 413 to huge ones", async () => {
    const bad = await fetch(
      base,
      json("PUT", { ...validBody(), time: "25:00" }),
    )
    assert.equal(bad.status, 400)
    assert.deepEqual(await bad.json(), { error: "Invalid time" })

    assert.equal((await fetch(base, json("PUT", "{nope"))).status, 400)
    assert.equal((await fetch(base, { method: "PUT" })).status, 400)
    assert.equal(
      (await fetch(base, json("DELETE", { endpoint: "http://x.y" }))).status,
      400,
    )
    const huge = { ...validBody(), padding: "x".repeat(10_000) }
    assert.equal((await fetch(base, json("PUT", huge))).status, 413)
  })
})

describe("reminder routes without VAPID keys", () => {
  it("answer 503", async () => {
    const app = express()
    setReminderEndpoints(app, undefined)
    const { server, base } = await listen(app)
    try {
      assert.equal((await fetch(`${base}/key`)).status, 503)
      assert.equal((await fetch(base, json("PUT", validBody()))).status, 503)
      assert.equal(
        (await fetch(base, json("DELETE", { endpoint: "https://a.b" }))).status,
        503,
      )
    } finally {
      server.close()
    }
  })
})
