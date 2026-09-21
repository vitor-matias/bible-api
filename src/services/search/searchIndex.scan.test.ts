import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  buildTextIndex,
  findPhrase,
  type TextEntry,
  tokenize,
} from "./searchIndex"

// findPhrase looks only at the verses holding the query's rarest word. This
// checks that shortcut against the obvious definition: scan every verse.

// A small deterministic generator, so a failure reproduces.
const random = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}

const VOCABULARY = [
  "amor",
  "deus",
  "de",
  "senhor",
  "paz",
  "e",
  "o",
  "ao",
  "luz",
  "terra",
  "ceu",
  "vida",
]

const pick = <T>(rand: () => number, items: readonly T[]): T =>
  items[Math.floor(rand() * items.length)]

const words = (rand: () => number, count: number): string =>
  Array.from({ length: count }, () => pick(rand, VOCABULARY)).join(" ")

const corpus = (rand: () => number, size: number): TextEntry[] =>
  Array.from({ length: size }, (_, i) => ({
    key: `verse:x:1:${i}`,
    searchId: `01-001-${String(i).padStart(3, "0")}`,
    segments: Array.from({ length: 1 + Math.floor(rand() * 3) }, () =>
      words(rand, 1 + Math.floor(rand() * 8)),
    ),
  }))

// Every verse whose segments contain the phrase, in verse order.
const scan = (entries: TextEntry[], query: string): string[] => {
  const phrase = ` ${tokenize(query).join(" ")} `
  if (tokenize(query).length === 0) return []

  return entries
    .filter((entry) =>
      entry.segments.some((segment) =>
        ` ${tokenize(segment).join(" ")} `.includes(phrase),
      ),
    )
    .map((entry) => entry.key)
}

describe("findPhrase agrees with scanning every verse", () => {
  const rand = random(42)
  const entries = corpus(rand, 400)
  const index = buildTextIndex(entries)

  const queries = [
    ...VOCABULARY,
    "absent",
    "amor absent",
    ...Array.from({ length: 60 }, () => words(rand, 2)),
    ...Array.from({ length: 40 }, () => words(rand, 3)),
    "deus, de amor!",
  ]

  it("returns the same verses, in the same order, for one page or all", () => {
    for (const query of queries) {
      const expected = scan(entries, query)
      const all = findPhrase(index, query, 0, 1000)

      assert.equal(all.total, expected.length, query)
      assert.deepEqual(all.keys, expected, query)
    }
  })

  it("pages the same way: any window is a slice of the full answer", () => {
    for (const query of queries.slice(0, 40)) {
      const expected = scan(entries, query)

      for (const [offset, limit] of [
        [0, 10],
        [10, 10],
        [7, 3],
        [expected.length, 5],
        [expected.length + 20, 5],
      ]) {
        const page = findPhrase(index, query, offset, limit)

        assert.equal(page.total, expected.length, `${query} total`)
        assert.deepEqual(
          page.keys,
          expected.slice(offset, offset + limit),
          `${query} [${offset}, ${limit}]`,
        )
      }
    }
  })

  it("lists a verse once however often the word occurs in it", () => {
    const repeated = buildTextIndex([
      { key: "verse:r:1:1", searchId: "01", segments: ["paz paz paz e paz"] },
    ])

    assert.deepEqual(findPhrase(repeated, "paz", 0, 10), {
      keys: ["verse:r:1:1"],
      total: 1,
    })
  })

  it("finds nothing when any word of the phrase is absent", () => {
    assert.deepEqual(findPhrase(index, "amor inexistente", 0, 10), {
      keys: [],
      total: 0,
    })
  })
})
