import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createFakeRedis } from "../../testing/fakeRedis"
import { setJson } from "../../util/jsonStore"
import {
  chapterDocument,
  chapterOutlineKey,
  saveChapterOutline,
} from "./chapterDocument"
import type { VerseForEmbedding } from "./storeChapter"

type Item = Verse["text"][number]

const text = (value: string): Item => ({
  type: "text",
  text: value,
  normalizedText: value,
})
const quote = (value: string): Item => ({
  type: "quote",
  text: value,
  normalizedText: value,
  identLevel: 1,
})
const heading = (tag: string, value: string): Item => ({
  type: "section",
  tag,
  text: value,
  normalizedText: value,
})
const verse = (
  bookId: string,
  chapterNumber: number,
  number: number,
  ...items: Item[]
): Verse => ({
  bookId,
  chapterNumber,
  number,
  numberLabel: String(number),
  text: items,
  searchId: "",
})
const forEmbedding = (verseData: Verse, value: string): VerseForEmbedding => ({
  verseData,
  text: value,
})

const outlineOf = (
  fake: ReturnType<typeof createFakeRedis>,
  bookId: string,
  chapter: number,
) =>
  fake.document<{ start: string[]; end: string[] }>(
    chapterOutlineKey(bookId, chapter),
  )

describe("saveChapterOutline", () => {
  it("records the outline at the start and at the end of a chapter", async () => {
    const fake = createFakeRedis()
    await saveChapterOutline(fake.client, "mat", 5, [
      verse(
        "mat",
        5,
        0,
        heading("ms", "II. ANÚNCIO DO REINO DO CÉU"),
        heading("s1", "Sermão da Montanha"),
        heading("s2", "As Bem-aventuranças"),
      ),
      verse("mat", 5, 3, text("Felizes os pobres em espírito")),
      verse("mat", 5, 12, text("Alegrai-vos"), heading("s2", "Sal da terra")),
    ])
    assert.deepEqual(await outlineOf(fake, "mat", 5), {
      start: [
        "II. ANÚNCIO DO REINO DO CÉU",
        "Sermão da Montanha",
        "As Bem-aventuranças",
        "",
      ],
      end: [
        "II. ANÚNCIO DO REINO DO CÉU",
        "Sermão da Montanha",
        "Sal da terra",
        "",
      ],
    })
  })

  it("starts each chapter where the previous chapter ended", async () => {
    const fake = createFakeRedis()
    await saveChapterOutline(fake.client, "mat", 5, [
      verse(
        "mat",
        5,
        0,
        heading("s1", "Sermão da Montanha"),
        heading("s2", "As Bem-aventuranças"),
      ),
    ])
    // A new section at the top of chapter 6 keeps the division around it.
    await saveChapterOutline(fake.client, "mat", 6, [
      verse("mat", 6, 0, heading("s2", "A esmola")),
      verse("mat", 6, 1, text("Guardai-vos")),
    ])
    // Chapter 7 opens mid-section: it inherits chapter 6's end unchanged.
    await saveChapterOutline(fake.client, "mat", 7, [
      verse("mat", 7, 1, text("Não julgueis")),
    ])
    assert.deepEqual((await outlineOf(fake, "mat", 6))?.start, [
      "",
      "Sermão da Montanha",
      "A esmola",
      "",
    ])
    assert.deepEqual((await outlineOf(fake, "mat", 7))?.start, [
      "",
      "Sermão da Montanha",
      "A esmola",
      "",
    ])
  })

  it("lets a heading replace its level and clear the levels below it", async () => {
    const fake = createFakeRedis()
    await saveChapterOutline(fake.client, "hab", 2, [
      verse(
        "hab",
        2,
        0,
        heading("ms", "I. PARTE"),
        heading("s1", "Divisão"),
        heading("s2", "Secção"),
      ),
      verse("hab", 2, 6, text("Ai"), heading("s3", "1ª")),
      verse("hab", 2, 9, text("Ai"), heading("s1", "Outra divisão")),
    ])
    assert.deepEqual((await outlineOf(fake, "hab", 2))?.end, [
      "I. PARTE",
      "Outra divisão",
      "",
      "",
    ])

    await saveChapterOutline(fake.client, "hab", 3, [
      verse("hab", 3, 0, heading("ms", "II. PARTE")),
    ])
    assert.deepEqual((await outlineOf(fake, "hab", 3))?.start, [
      "II. PARTE",
      "",
      "",
      "",
    ])
  })

  it("maps unusual tags onto the nearest level and skips blank headings", async () => {
    const fake = createFakeRedis()
    await saveChapterOutline(fake.client, "gen", 1, [
      verse(
        "gen",
        1,
        0,
        heading("ms2", "PARTE"),
        heading("s", "Secção sem número"),
        heading("s4", "Subsecção funda"),
        heading("s2", "   "),
      ),
    ])
    assert.deepEqual((await outlineOf(fake, "gen", 1))?.start, [
      "PARTE",
      "",
      "Secção sem número",
      "Subsecção funda",
    ])
  })
})

describe("chapterDocument", () => {
  const withOutline = async (
    bookId: string,
    chapter: number,
    bookName: string | null,
    verse0: Verse,
  ) => {
    const fake = createFakeRedis()
    if (bookName)
      await setJson(fake.client, `book:${bookId}`, {
        id: bookId,
        name: bookName,
      })
    await saveChapterOutline(fake.client, bookId, chapter, [verse0])
    return fake
  }

  it("opens with the book, the chapter and the outline in effect there", async () => {
    const fake = await withOutline(
      "mat",
      6,
      "Evangelho de São Mateus",
      verse(
        "mat",
        6,
        0,
        heading("ms", "II. ANÚNCIO DO REINO DO CÉU"),
        heading("s1", "Sermão da Montanha"),
        heading("s2", "A esmola"),
      ),
    )
    const v1 = verse("mat", 6, 1, text("Guardai-vos"))
    assert.deepEqual(
      await chapterDocument(fake.client, [forEmbedding(v1, "Guardai-vos")]),
      [
        {
          text: "Evangelho de São Mateus, capítulo 6: II. ANÚNCIO DO REINO DO CÉU — Sermão da Montanha — A esmola",
          embed: false,
        },
        { text: "Guardai-vos", embed: true },
      ],
    )
  })

  it("calls a psalm by its number", async () => {
    const fake = await withOutline(
      "psa",
      23,
      "Livro dos Salmos",
      verse("psa", 23, 0, heading("s2", "O BOM PASTOR")),
    )
    const v1 = verse("psa", 23, 1, text("O Senhor é meu pastor"))
    const [context] = await chapterDocument(fake.client, [
      forEmbedding(v1, "O Senhor é meu pastor"),
    ])
    assert.equal(context.text, "Livro dos Salmos, Salmo 23: O BOM PASTOR")
  })

  it("falls back to the chapter alone when the book or outline is missing", async () => {
    const v1 = verse("gen", 3, 1, text("A serpente"))
    const bare = createFakeRedis()
    assert.equal(
      (await chapterDocument(bare.client, [forEmbedding(v1, "A serpente")]))[0]
        .text,
      "capítulo 3",
    )

    const named = await withOutline(
      "gen",
      3,
      "Livro do Génesis",
      verse("gen", 3, 0),
    )
    assert.equal(
      (await chapterDocument(named.client, [forEmbedding(v1, "A serpente")]))[0]
        .text,
      "Livro do Génesis, capítulo 3",
    )
  })

  it("moves a heading that trails a verse to just after it", async () => {
    const fake = await withOutline(
      "luk",
      10,
      "Evangelho de São Lucas",
      verse("luk", 10, 0),
    )
    const v28 = verse(
      "luk",
      10,
      28,
      text("Respondeste bem; faz isso e viverás."),
      heading("s2", "Parábola do bom samaritano"),
    )
    const v29 = verse("luk", 10, 29, text("E quem é o meu próximo?"))
    const doc = await chapterDocument(fake.client, [
      forEmbedding(v28, "Respondeste bem; faz isso e viverás."),
      forEmbedding(v29, "E quem é o meu próximo?"),
    ])
    assert.deepEqual(doc.slice(1), [
      { text: "Respondeste bem; faz isso e viverás.", embed: true },
      { text: "Parábola do bom samaritano", embed: false },
      { text: "E quem é o meu próximo?", embed: true },
    ])
  })

  it("keeps a heading that opens a verse just before it", async () => {
    const fake = await withOutline(
      "luk",
      10,
      "Evangelho de São Lucas",
      verse("luk", 10, 0),
    )
    const v12 = verse(
      "luk",
      10,
      12,
      heading("s2", "Lamentação sobre as cidades do lago"),
      text("Digo-vos"),
    )
    const doc = await chapterDocument(fake.client, [
      forEmbedding(v12, "Digo-vos"),
    ])
    assert.deepEqual(doc.slice(1), [
      { text: "Lamentação sobre as cidades do lago", embed: false },
      { text: "Digo-vos", embed: true },
    ])
  })

  it("does not count an empty quote marker as verse content", async () => {
    const fake = await withOutline(
      "psa",
      1,
      "Livro dos Salmos",
      verse("psa", 1, 0),
    )
    const v = verse(
      "psa",
      1,
      4,
      quote("​"),
      heading("s2", "Os ímpios"),
      text("Não são assim os ímpios"),
    )
    const doc = await chapterDocument(fake.client, [
      forEmbedding(v, "Não são assim os ímpios"),
    ])
    assert.deepEqual(doc.slice(1), [
      { text: "Os ímpios", embed: false },
      { text: "Não são assim os ímpios", embed: true },
    ])
  })
})
