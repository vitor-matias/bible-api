import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { createClient } from "redis"
import { isDataImported } from "./importMarker"

type Client = ReturnType<typeof createClient>

// The two commands isDataImported uses. `pages` are the batches SCAN returns.
const fakeClient = (marker: boolean, pages: string[][]) => {
  const state = { scanned: false }

  const client = {
    exists: async () => (marker ? 1 : 0),
    scanIterator: async function* () {
      state.scanned = true
      for (const page of pages) yield page
    },
  } as unknown as Client

  return { client, state }
}

describe("isDataImported", () => {
  it("is true when the marker is set and the database holds verses", async () => {
    const { client } = fakeClient(true, [["verse:gen:1:1", "verse:gen:1:2"]])

    assert.equal(await isDataImported(client), true)
  })

  it("keeps scanning past empty pages", async () => {
    const { client } = fakeClient(true, [[], [], ["verse:gen:1:1"]])

    assert.equal(await isDataImported(client), true)
  })

  it("is false without the marker, without looking at the data", async () => {
    const { client, state } = fakeClient(false, [["verse:gen:1:1"]])

    assert.equal(await isDataImported(client), false)
    assert.equal(state.scanned, false)
  })

  it("is false when the marker is set but there are no verses", async () => {
    const { client } = fakeClient(true, [[], []])

    assert.equal(await isDataImported(client), false)
  })
})
