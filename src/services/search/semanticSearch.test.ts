import assert from "node:assert/strict"
import { after, before, describe, it } from "node:test"
import { createFakeRedis } from "../../testing/fakeRedis"
import { startVoyageStub } from "../../testing/voyageStub"
import {
  capPerChapter,
  KNN_MAX_RESULTS,
  MAX_VERSES_PER_CHAPTER,
  semanticSearchVerses,
} from "./semanticSearch"

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

describe("semanticSearchVerses", () => {
  let stub: Awaited<ReturnType<typeof startVoyageStub>>

  before(async () => {
    stub = await startVoyageStub()
    process.env.VOYAGE_API_KEY = "al-test"
    process.env.VOYAGE_BASE_URL = stub.url
  })

  after(async () => {
    await stub.close()
  })

  // The index's ranked answer, best first: three verses of Romans 13 ahead of
  // the parallels elsewhere.
  const ranked = [
    key("rom", 13, 8),
    key("rom", 13, 9),
    key("rom", 13, 10),
    key("mrk", 12, 31),
    key("lev", 19, 18),
  ]

  const searchOver = async (keys: string[]) => {
    const calls: { query: string; options: { LIMIT: { size: number } } }[] = []
    const fake = createFakeRedis((_index, query, options) => {
      calls.push({ query, options: options as { LIMIT: { size: number } } })
      return {
        total: keys.length,
        documents: keys.map((verseKey) => ({
          id: verseKey.replace("verse:", "embedding:"),
          value: { key: verseKey },
        })),
      }
    })
    for (const verseKey of keys) {
      const [, bookId, chapter, verse] = verseKey.split(":")
      await fake.client.json.set(verseKey, "$", {
        bookId,
        chapterNumber: Number(chapter),
        number: Number(verse),
      })
    }
    return { client: fake.client, calls }
  }

  const refs = (page: { verses: Verse[] }) =>
    page.verses.map((v) => `${v.bookId} ${v.chapterNumber}:${v.number}`)

  it("caps each chapter at two verses before paging", async () => {
    const { client, calls } = await searchOver(ranked)

    const first = await semanticSearchVerses(client, "amar o próximo", 1, 2)
    const second = await semanticSearchVerses(client, "amar o próximo", 2, 2)

    assert.deepEqual(refs(first), ["rom 13:8", "rom 13:9"])
    assert.deepEqual(refs(second), ["mrk 12:31", "lev 19:18"])
    assert.equal(first.total, 4)
    assert.equal(first.totalPages, 2)
    assert.equal(second.currentPage, 2)
    // Enough neighbours are fetched for the cap to still fill the window.
    assert.match(calls[0].query, /KNN 1000 @embedding/)
    assert.equal(calls[0].options.LIMIT.size, 1000)
  })

  it("keeps the window at KNN_MAX_RESULTS after the cap", async () => {
    const many = Array.from({ length: 150 }, (_, i) => key("psa", i + 1, 1))
    const { client } = await searchOver(many)

    const page = await semanticSearchVerses(client, "louvor", 1, 10)

    assert.equal(page.total, KNN_MAX_RESULTS)
    assert.equal(page.totalPages, KNN_MAX_RESULTS / 10)
  })

  it("returns an empty page when nothing matches", async () => {
    const { client } = await searchOver([])

    assert.deepEqual(await semanticSearchVerses(client, "nada", 1, 10), {
      verses: [],
      total: 0,
      currentPage: 1,
      totalPages: 0,
    })
  })

  it("does not call the API for a page beyond the window", async () => {
    const { client, calls } = await searchOver(ranked)
    stub.requests.length = 0

    const page = await semanticSearchVerses(client, "amar", 11, 10)

    assert.equal(page.total, 0)
    assert.equal(stub.requests.length, 0)
    assert.equal(calls.length, 0)
  })
})
