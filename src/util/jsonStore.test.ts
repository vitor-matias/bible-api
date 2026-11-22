import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { createClient } from "redis"
import { getJson, mGetJson, setJson } from "./jsonStore"

type Client = ReturnType<typeof createClient>

// The three commands the helpers use, backed by a Map, standing in for a server.
const fakeClient = () => {
  const data = new Map<string, string>()
  const calls: string[] = []

  const client = {
    set: async (key: string, value: string) => {
      calls.push("set")
      data.set(key, value)
      return "OK"
    },
    get: async (key: string) => {
      calls.push("get")
      return data.get(key) ?? null
    },
    mGet: async (keys: string[]) => {
      calls.push("mGet")
      return keys.map((key) => data.get(key) ?? null)
    },
  } as unknown as Client

  return { client, data, calls }
}

describe("jsonStore", () => {
  it("stores a value as a plain JSON string", async () => {
    const { client, data } = fakeClient()

    await setJson(client, "book:gen", { id: "gen", chapterCount: 50 })

    assert.equal(data.get("book:gen"), '{"id":"gen","chapterCount":50}')
  })

  it("reads back what it stored, with accents intact", async () => {
    const { client } = fakeClient()

    await setJson(client, "k", { name: "Génesis", n: [1, 2] })

    assert.deepEqual(await getJson(client, "k"), { name: "Génesis", n: [1, 2] })
  })

  it("returns null for a missing key", async () => {
    const { client } = fakeClient()

    assert.equal(await getJson(client, "nope"), null)
  })

  it("keeps a missing key in position when reading many", async () => {
    const { client } = fakeClient()
    await setJson(client, "a", { v: 1 })
    await setJson(client, "c", { v: 3 })

    assert.deepEqual(await mGetJson(client, ["a", "b", "c"]), [
      { v: 1 },
      null,
      { v: 3 },
    ])
  })

  it("does not call the server for an empty list of keys", async () => {
    const { client, calls } = fakeClient()

    assert.deepEqual(await mGetJson(client, []), [])
    assert.deepEqual(calls, [])
  })
})
