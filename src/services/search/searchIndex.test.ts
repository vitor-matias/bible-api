import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  buildTextIndex,
  findPhrase,
  nearest,
  type TextEntry,
  tokenize,
  toSegments,
} from "./searchIndex"

const entry = (
  key: string,
  searchId: string,
  ...segments: string[]
): TextEntry => ({ key, searchId, segments })

const find = (entries: TextEntry[], query: string, offset = 0, limit = 10) =>
  findPhrase(buildTextIndex(entries), query, offset, limit)

describe("tokenize", () => {
  it("splits on anything that is not a letter or digit", () => {
    assert.deepEqual(tokenize("amai-vos, uns aos outros: 1,2"), [
      "amai",
      "vos",
      "uns",
      "aos",
      "outros",
      "1",
      "2",
    ])
  })

  it("returns nothing for text without words", () => {
    assert.deepEqual(tokenize("«…» — !"), [])
    assert.deepEqual(tokenize(""), [])
  })
})

describe("findPhrase", () => {
  const verses = [
    entry("verse:b:1:1", "02-001-001", "o amor de deus e grande"),
    entry("verse:a:1:1", "01-001-001", "deus e amor"),
    entry("verse:a:1:2", "01-001-002", "os amores passam"),
  ]

  it("matches whole words only, with no stemming", () => {
    // "amor" is not found inside "amores", and "amores" is a word of its own.
    assert.deepEqual(find(verses, "amor").keys, ["verse:a:1:1", "verse:b:1:1"])
    assert.deepEqual(find(verses, "amores").keys, ["verse:a:1:2"])
  })

  it("does not match part of a word", () => {
    assert.equal(find(verses, "mor").total, 0)
    assert.equal(find(verses, "grand").total, 0)
  })

  it("matches a phrase only when its words are adjacent and in order", () => {
    assert.deepEqual(find(verses, "de deus").keys, ["verse:b:1:1"])
    assert.equal(find(verses, "deus de").total, 0)
    assert.equal(find(verses, "amor grande").total, 0)
  })

  it("ignores punctuation in the query", () => {
    assert.deepEqual(find(verses, "deus, e amor!").keys, ["verse:a:1:1"])
  })

  it("returns nothing for a query with no words", () => {
    assert.deepEqual(find(verses, "!!!"), { keys: [], total: 0 })
    assert.deepEqual(find(verses, ""), { keys: [], total: 0 })
  })

  it("orders results by searchId whatever order the verses were loaded in", () => {
    assert.deepEqual(find(verses, "deus").keys, ["verse:a:1:1", "verse:b:1:1"])
  })

  it("pages through the matches and counts them all", () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      entry(`verse:x:1:${i}`, `03-001-${String(i).padStart(3, "0")}`, "paz"),
    )

    const second = find(many, "paz", 10, 10)

    assert.equal(second.total, 25)
    assert.deepEqual(
      second.keys,
      Array.from({ length: 10 }, (_, i) => `verse:x:1:${i + 10}`),
    )
    assert.equal(find(many, "paz", 20, 10).keys.length, 5)
    assert.deepEqual(find(many, "paz", 30, 10).keys, [])
  })

  it("never matches a phrase across two segments", () => {
    // A verse followed by the heading of the next passage: "amor" ends one
    // segment and "de deus" starts the other, but they are not one phrase.
    const index = [
      entry("verse:h:1:1", "04-001-001", "todo o amor", "de deus e paz"),
    ]

    assert.equal(find(index, "amor de deus").total, 0)
    assert.equal(find(index, "todo o amor").total, 1)
    assert.equal(find(index, "de deus e paz").total, 1)
  })
})

describe("toSegments", () => {
  const text = (normalizedText: string, type = "text") =>
    ({ type, text: normalizedText, normalizedText }) as Verse["text"][number]

  it("runs consecutive text nodes together, so a divine name does not split a phrase", () => {
    // "apresentou ao " + "Senhor" (its own node in the source) + " uma oferta".
    const segments = toSegments({
      text: [text("apresentou ao "), text("senhor"), text(" uma oferta")],
    })

    assert.equal(segments.length, 1)
    assert.deepEqual(
      find([entry("k", "01", ...segments)], "ao senhor uma oferta").keys,
      ["k"],
    )
  })

  it("keeps each heading and cross-reference apart from the text and from each other", () => {
    const segments = toSegments({
      text: [
        text("ora, onde ha perdao"),
        text("iv. a fe perseverante", "section"),
        text("(10,19-12,29)", "references"),
        text("apelo a evitar a apostasia", "section"),
      ],
    })

    assert.deepEqual(segments, [
      "ora, onde ha perdao",
      "iv. a fe perseverante",
      "(10,19-12,29)",
      "apelo a evitar a apostasia",
    ])
  })

  it("starts a new stretch of running text after a heading", () => {
    const segments = toSegments({
      text: [text("um"), text("titulo", "section"), text("dois"), text("tres")],
    })

    assert.deepEqual(segments, ["um", "titulo", "dois tres"])
  })

  it("skips footnotes and nodes without text", () => {
    const segments = toSegments({
      text: [
        { type: "footnote", text: "nota de Deus", reference: "1,1" },
        text(""),
        text("verso"),
        { type: "paragraph", text: "\n", normalizedText: "" },
      ],
    })

    assert.deepEqual(segments, ["verso"])
  })
})

describe("nearest", () => {
  // Three unit vectors in two dimensions, at 0, 90 and 45 degrees.
  const half = Math.SQRT1_2
  const index = {
    keys: ["east", "north", "northeast"],
    matrix: new Float32Array([1, 0, 0, 1, half, half]),
    dimensions: 2,
  }

  it("ranks by cosine similarity, best first", () => {
    const results = nearest(index, new Float32Array([1, 0]), 3)

    assert.deepEqual(
      results.map((result) => result.key),
      ["east", "northeast", "north"],
    )
    assert.ok(Math.abs(results[0].score - 1) < 1e-6)
    assert.ok(Math.abs(results[1].score - half) < 1e-6)
    assert.ok(Math.abs(results[2].score) < 1e-6)
  })

  it("returns only the k closest", () => {
    const results = nearest(index, new Float32Array([0, 1]), 2)

    assert.deepEqual(
      results.map((result) => result.key),
      ["north", "northeast"],
    )
  })

  it("returns every row, best first, when k exceeds the rows", () => {
    assert.equal(nearest(index, new Float32Array([1, 0]), 10).length, 3)
  })

  it("returns nothing for an empty index", () => {
    const empty = { keys: [], matrix: new Float32Array(0), dimensions: 2 }

    assert.deepEqual(nearest(empty, new Float32Array([1, 0]), 5), [])
  })

  it("keeps the k best even when they arrive out of order", () => {
    // 200 rows along a line: the score rises with the row number, so each new
    // row displaces the current worst of the top k.
    const rows = 200
    const matrix = new Float32Array(rows * 2)
    const keys: string[] = []
    for (let row = 0; row < rows; row++) {
      matrix[row * 2] = row / rows
      keys.push(`row${row}`)
    }

    const results = nearest(
      { keys, matrix, dimensions: 2 },
      new Float32Array([1, 0]),
      5,
    )

    assert.deepEqual(
      results.map((result) => result.key),
      ["row199", "row198", "row197", "row196", "row195"],
    )
  })
})
