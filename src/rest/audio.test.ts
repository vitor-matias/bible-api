import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { fakeRequest, fakeResponse } from "../testing/fakeExpress"
import { loadAudioIndex, makeAudioController } from "./audio"

const episode = {
  day: 3,
  title: "Dia 3 - A Arca de Noé",
  url: "https://x/3.m4a",
  start: 56.5,
  end: 280.8,
}
const controller = makeAudioController({ "gen/5": [episode] })

const call = (book: string, chapter: string) => {
  const { res, sent } = fakeResponse()
  controller(fakeRequest({ params: { book, chapter } }), res)
  return sent
}

describe("audio controller", () => {
  it("answers a chapter's episodes", () => {
    assert.deepEqual(call("gen", "5"), {
      status: 200,
      body: { episodes: [episode] },
    })
  })

  it("answers 404 for a chapter no episode reads", () => {
    assert.equal(call("gen", "50").status, 404)
  })

  it("does not answer inherited object keys", () => {
    assert.equal(call("constructor", "x").status, 404)
    assert.equal(call("__proto__", "").status, 404)
  })

  it("loads the committed index", () => {
    const index = loadAudioIndex()
    assert.ok(Object.keys(index).length > 0)
    for (const [key, episodes] of Object.entries(index)) {
      assert.match(key, /^[0-9a-z]{3}\/\d+$/)
      for (const e of episodes) assert.match(e.url, /^https:\/\/anchor\.fm\//)
    }
  })
})
