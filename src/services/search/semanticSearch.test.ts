import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { capPerChapter, MAX_VERSES_PER_CHAPTER } from "./semanticSearch"

const key = (book: string, chapter: number, verse: number) =>
  `verse:${book}:${chapter}:${verse}`

describe("capPerChapter", () => {
  it("keeps at most two verses per chapter by default", () => {
    assert.equal(MAX_VERSES_PER_CHAPTER, 2)
    const ranked = [
      key("rom", 13, 8),
      key("rom", 13, 9),
      key("rom", 13, 10),
      key("mrk", 12, 31),
      key("rom", 13, 7),
      key("lev", 19, 18),
    ]
    assert.deepEqual(capPerChapter(ranked), [
      key("rom", 13, 8),
      key("rom", 13, 9),
      key("mrk", 12, 31),
      key("lev", 19, 18),
    ])
  })

  it("keeps the ranked order of what survives", () => {
    const ranked = [key("luk", 10, 33), key("jhn", 8, 4), key("luk", 10, 30)]
    assert.deepEqual(capPerChapter(ranked), ranked)
  })

  it("counts each chapter of a book separately", () => {
    const ranked = [
      key("mat", 5, 3),
      key("mat", 5, 4),
      key("mat", 6, 1),
      key("mat", 5, 5),
      key("mat", 6, 2),
    ]
    assert.deepEqual(capPerChapter(ranked), [
      key("mat", 5, 3),
      key("mat", 5, 4),
      key("mat", 6, 1),
      key("mat", 6, 2),
    ])
  })

  it("does not confuse chapters or books that share a prefix", () => {
    const ranked = [
      key("mat", 1, 1),
      key("mat", 11, 1),
      key("mat", 1, 2),
      key("mat", 11, 2),
      key("1co", 13, 4),
      key("2co", 13, 4),
      key("mat", 1, 3),
    ]
    assert.deepEqual(capPerChapter(ranked), ranked.slice(0, 6))
  })

  it("honours a different limit", () => {
    const ranked = [key("psa", 23, 1), key("psa", 23, 4), key("jhn", 10, 11)]
    assert.deepEqual(capPerChapter(ranked, 1), [
      key("psa", 23, 1),
      key("jhn", 10, 11),
    ])
  })

  it("returns an empty list for no results", () => {
    assert.deepEqual(capPerChapter([]), [])
  })
})
