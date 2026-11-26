import assert from "node:assert/strict"
import type { AddressInfo } from "node:net"
import { after, before, describe, it } from "node:test"
import express from "express"
import { setImportState } from "../util/importState"
import setEndpoints from "./index"

describe("import gate", () => {
  let server: ReturnType<express.Express["listen"]>
  let base: string

  before(async () => {
    const app = express()
    setEndpoints(app)
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve())
    })
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    setImportState("loading")
  })

  after(() => {
    server.close()
  })

  it("keeps serving the podcast routes during an import", async () => {
    assert.equal((await fetch(`${base}/v1/mais365`)).status, 200)
  })

  it("still gates every other route", async () => {
    const res = await fetch(`${base}/v1/gen/1`)
    assert.equal(res.status, 503)
    assert.deepEqual(await res.json(), {
      error: "Bible data is not available yet",
      status: "loading",
    })
  })
})
