import assert from "node:assert/strict"
import type { AddressInfo } from "node:net"
import { after, before, describe, it } from "node:test"
import express from "express"
import { fullBookRateLimit, searchRateLimit } from "./rateLimiter"

let server: ReturnType<ReturnType<typeof express>["listen"]>
let base: string

before(async () => {
  const app = express()
  app.get("/search", searchRateLimit, (_req, res) => {
    res.json({ ok: true })
  })
  app.get("/books", fullBookRateLimit, (_req, res) => {
    res.json({ ok: true })
  })
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve())
  })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(() => {
  server.close()
})

// Sends `count` requests and returns the status of each.
const hit = async (path: string, count: number) => {
  const statuses: number[] = []
  for (let i = 0; i < count; i++) {
    // Sequential on purpose: the limit is counted per request in order.
    const response = await fetch(`${base}${path}`) // NOSONAR
    await response.arrayBuffer()
    statuses.push(response.status)
  }
  return statuses
}

describe("searchRateLimit", () => {
  it("allows ten semantic searches a minute", async () => {
    const statuses = await hit("/search?semantic=true", 11)
    assert.deepEqual(statuses.slice(0, 10), new Array(10).fill(200))
    assert.equal(statuses[10], 429)
  })

  it("counts plain searches against their own, larger budget", async () => {
    const statuses = await hit("/search?text=a", 11)
    assert.deepEqual(statuses, new Array(11).fill(200))
  })
})

describe("fullBookRateLimit", () => {
  it("leaves plain listings unlimited and limits full-book reads", async () => {
    assert.deepEqual(await hit("/books", 12), new Array(12).fill(200))

    const statuses = await hit("/books?withChapters=true", 11)
    assert.deepEqual(statuses.slice(0, 10), new Array(10).fill(200))
    assert.equal(statuses[10], 429)
  })
})
