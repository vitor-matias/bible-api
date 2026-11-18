import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { fakeBible } from "../testing/bibleFixture"
import { createFakeRedis } from "../testing/fakeRedis"
import { NotFoundError } from "../util/errors"
import { getBook } from "./book/getBook"
import {
  chapterTitleKey,
  getBookChapterTitle,
} from "./chapter/getBookChapterTitle"
import { getChapter } from "./chapter/getChapter"
import { chapterVerseMaxKey } from "./chapter/verseCountKey"
import { getIntro, listIntros } from "./intro/getIntro"
import { INTRO_LIST_KEY, introKey } from "./usfmImportService/storeIntro"

describe("getChapter", () => {
  it("returns the verses indexed by number, with the stored title", async () => {
    const { client } = await fakeBible()

    const chapter = await getChapter(client, "gen", 1)

    assert.equal(chapter.title, "A criação")
    assert.deepEqual(
      chapter.verses?.map((verse) => verse?.number),
      [0, 1, 2, 3],
    )
  })

  it("leaves a hole for a missing verse 0 and uses a title it is given", async () => {
    const { client } = await fakeBible()

    const chapter = await getChapter(client, "gen", 2, "Dada")

    assert.equal(chapter.title, "Dada")
    assert.equal(chapter.verses?.[0], undefined)
    assert.equal(chapter.verses?.length, 3)
  })

  it("throws NotFoundError for a missing, malformed or corrupt chapter", async () => {
    const { client } = await fakeBible()
    await client.set(chapterVerseMaxKey("gen", 7), "2junk")
    await client.set(chapterVerseMaxKey("gen", 8), "100000")
    // A marker with no verse behind it.
    await client.set(chapterVerseMaxKey("gen", 9), "3")

    for (const chapter of [3, Number.NaN, 1.5, 7, 8, 9]) {
      await assert.rejects(
        getChapter(client, "gen", chapter),
        NotFoundError,
        String(chapter),
      )
    }
  })
})

describe("getBookChapterTitle", () => {
  it("returns the stored title, or an empty one", async () => {
    const { client } = createFakeRedis()
    await client.set(chapterTitleKey("gen", 1), "A criação")

    assert.deepEqual(await getBookChapterTitle(client, "gen", 1), {
      title: "A criação",
      number: 1,
      bookId: "gen",
    })
    assert.equal((await getBookChapterTitle(client, "gen", 2)).title, "")
  })
})

describe("getBook", () => {
  it("lists chapter titles without reading verses", async () => {
    const { client } = await fakeBible()

    const book = await getBook(client, "gen")

    assert.equal(book?.chapterCount, 3)
    assert.deepEqual(book?.chapters, [
      { bookId: "gen", number: 1, title: "A criação" },
      { bookId: "gen", number: 2, title: "" },
      { bookId: "gen", number: 3, title: "" },
    ])
  })

  it("reads every stored chapter, skips absent ones, and keeps the count", async () => {
    const { client } = await fakeBible()

    const book = await getBook(client, "gen", true)

    assert.deepEqual(
      book?.chapters?.map((chapter) => chapter.number),
      [1, 2],
    )
    assert.equal(book?.chapters?.[0].title, "A criação")
    assert.equal(book?.chapterCount, 3)
  })

  it("surfaces errors other than a missing chapter", async () => {
    const { client } = await fakeBible()
    Object.assign(client.json, {
      mGet: async () => {
        throw new Error("connection lost")
      },
    })

    await assert.rejects(getBook(client, "gen", true), /connection lost/)
  })

  it("returns an empty chapter list for a book with none, and null for no book", async () => {
    const { client } = createFakeRedis()
    await client.json.set("book:frt", "$", { id: "frt", chapterCount: 0 })

    assert.deepEqual((await getBook(client, "frt"))?.chapters, [])
    assert.equal(await getBook(client, "xyz"), null)
  })
})

describe("getIntro / listIntros", () => {
  it("returns one introduction by slug and lists name and slug only", async () => {
    const { client } = createFakeRedis()
    const intro = {
      slug: "pentateuco",
      name: "Pentateuco",
      introduction: [{ type: "introParagraph", text: "Texto." }],
    }
    await client.rPush(INTRO_LIST_KEY, "pentateuco")
    // A slug listed without a document behind it is skipped.
    await client.rPush(INTRO_LIST_KEY, "missing")
    await client.json.set(introKey("pentateuco"), "$", intro)

    assert.deepEqual(await getIntro(client, "pentateuco"), intro)
    assert.equal(await getIntro(client, "missing"), null)
    assert.deepEqual(await listIntros(client), [
      { slug: "pentateuco", name: "Pentateuco" },
    ])
  })

  it("lists nothing when there are no introductions", async () => {
    assert.deepEqual(await listIntros(createFakeRedis().client), [])
  })
})
