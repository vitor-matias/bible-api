import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { fakeRequest, fakeResponse } from "../testing/fakeExpress"
import {
  loadAudioIndex,
  loadPlan,
  makeAudioController,
  makePlanController,
  makePlanDayController,
  type PlanDay,
} from "./audio"

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

describe("plan controllers", () => {
  const day: PlanDay = {
    day: 6,
    title: "Confiança no Senhor",
    theme: "Confiança no Senhor",
    priest: "Padre Miguel Vasconcelos",
    url: "https://anchor.fm/s/x/6.m4a",
    duration: 1275,
    readings: [
      {
        bookId: "pro",
        bookName: "Provérbios",
        chapter: 1,
        range: [1, 7],
        episode: { ...episode, day: 6, range: [1, 7], verses: [[1, 60]] },
      },
    ],
    reflection: 400,
  }
  const intro: PlanDay = { ...day, day: 6.5, readings: [], reflection: 0 }
  const send = (
    controller: (
      req: ReturnType<typeof fakeRequest>,
      res: ReturnType<typeof fakeResponse>["res"],
    ) => unknown,
    params: Record<string, string> = {},
  ) => {
    const { res, sent } = fakeResponse()
    controller(fakeRequest({ params }), res)
    return sent
  }

  it("lists every day without its verse timings", () => {
    const { body } = send(makePlanController([day, intro])) as {
      body: { days: PlanDay[] }
    }
    assert.equal(body.days.length, 2)
    assert.equal(body.days[0].readings[0].episode.verses, undefined)
    assert.deepEqual(body.days[0].readings[0].range, [1, 7])
  })

  it("answers one day in full, an introduction by its half day", () => {
    const controller = makePlanDayController([day, intro])
    assert.deepEqual(send(controller, { day: "6" }).body, day)
    assert.equal((send(controller, { day: "6.5" }).body as PlanDay).day, 6.5)
    assert.equal(send(controller, { day: "7" }).status, 404)
  })

  it("loads the committed plan, in order", () => {
    const days = loadPlan()
    assert.ok(days.length > 0)
    assert.deepEqual(
      days.map((d) => d.day),
      [...days.map((d) => d.day)].sort((a, b) => a - b),
    )
  })
})
