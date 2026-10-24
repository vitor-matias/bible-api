import assert from "node:assert/strict"
import { after, before, describe, it } from "node:test"
import * as usfm from "usfm-js"
import { fakeBible } from "../../testing/bibleFixture"
import { createFakeRedis } from "../../testing/fakeRedis"
import {
  errorResponse,
  reversedVectors,
  startVoyageStub,
} from "../../testing/voyageStub"
import type { TaskPool } from "../../util/concurrency"
import { setJson } from "../../util/jsonStore"
import { verseKey } from "../verse/getVerse"
import { retryFailedEmbeddings } from "./retryEmbeddings"
import { storeBook } from "./storeBook"
import { EMBEDDING_FAILURES_KEY } from "./storeChapter"
import {
  INTRO_LIST_KEY,
  introSlugFromFileName,
  isPeripheralBookId,
  storeIntro,
} from "./storeIntro"
import { parseFootnote, storeVerse } from "./storeVerse"

// Runs nothing: these tests check what is stored, not the embedding calls.
const idlePool: TaskPool = { submit: () => {}, drain: async () => {} }

let stub: Awaited<ReturnType<typeof startVoyageStub>>

before(async () => {
  stub = await startVoyageStub()
  process.env.VOYAGE_API_KEY = "al-test"
  process.env.VOYAGE_BASE_URL = stub.url
})

after(async () => {
  await stub.close()
})

describe("introSlugFromFileName / isPeripheralBookId", () => {
  it("derives a stable slug from the file name", () => {
    assert.equal(
      introSlugFromFileName("00_Intro_Pentateuco.usfm"),
      "pentateuco",
    )
    assert.equal(
      introSlugFromFileName("00_Intro_CartasPaulo.USFM"),
      "cartaspaulo",
    )
    assert.equal(introSlugFromFileName("00_Intro_Génesis.usfm"), "genesis")
    // Nothing left after the prefixes: fall back to the whole name.
    assert.equal(introSlugFromFileName("00_Intro.usfm"), "00-intro")
    // No slug-able character at all: hex of the name.
    assert.equal(introSlugFromFileName("__.usfm"), "5f5f")
  })

  it("recognises front-matter ids, even with trailing text", () => {
    assert.equal(isPeripheralBookId("frt"), true)
    assert.equal(isPeripheralBookId("int intro geral"), true)
    assert.equal(isPeripheralBookId("gen"), false)
  })
})

describe("storeIntro", () => {
  it("stores introductions by slug and suffixes a colliding slug", async () => {
    const fake = createFakeRedis()

    await storeIntro(fake.client, "geral", "Geral", [])
    await storeIntro(fake.client, "geral", "Geral 2", [])

    assert.deepEqual(fake.lists.get(INTRO_LIST_KEY), ["geral", "geral-2"])
    assert.equal(fake.document<BookIntro>("intro:geral-2")?.name, "Geral 2")
  })

  it("gives up after too many collisions", async () => {
    const fake = createFakeRedis()
    await fake.client.rPush(INTRO_LIST_KEY, "x")
    for (let n = 2; n <= 100; n++)
      await fake.client.rPush(INTRO_LIST_KEY, `x-${n}`)

    await assert.rejects(storeIntro(fake.client, "x", "X", []), /collides/)
  })
})

describe("storeBook", () => {
  it("stores a book with its introduction and chapters", async () => {
    const fake = createFakeRedis()
    const book = usfm.toJSON(String.raw`\id GEN
\toc1 Génesis
\toc2 Gn
\toc3 Gn
\ip Introdução.
\c 1
\p
\v 1 No princípio.
`)

    await storeBook(fake.client, book, "01_Genesis.usfm", idlePool)

    assert.deepEqual(fake.lists.get("books"), ["gen"])
    assert.deepEqual(fake.document("book:gen"), {
      id: "gen",
      name: "Génesis",
      shortName: "Gn",
      abrv: "Gn",
      chapterCount: 1,
      introduction: [{ type: "introParagraph", text: "Introdução." }],
    })
    assert.ok(fake.strings.has(verseKey("gen", 1, 1)))
  })

  it("stores front matter as an introduction, outside the book list", async () => {
    const fake = createFakeRedis()
    const frontMatter = (intro: string) =>
      usfm.toJSON(String.raw`\id FRT
\h Introdução geral
${intro}
`)

    await storeBook(
      fake.client,
      frontMatter(String.raw`\ip Texto.`),
      "00_Intro_Geral.usfm",
      idlePool,
    )
    // No introduction content: skipped.
    await storeBook(
      fake.client,
      frontMatter(""),
      "00_Intro_Vazia.usfm",
      idlePool,
    )
    // No id at all: skipped.
    await storeBook(
      fake.client,
      usfm.toJSON(String.raw`\h Nada`),
      "x.usfm",
      idlePool,
    )

    assert.equal(fake.lists.get("books"), undefined)
    assert.deepEqual(fake.lists.get(INTRO_LIST_KEY), ["geral"])
    assert.equal(
      fake.document<BookIntro>("intro:geral")?.name,
      "Introdução geral",
    )
  })
})

describe("parseFootnote / storeVerse", () => {
  it("reads reference and body, including \\fp paragraphs and notes without \\fr", () => {
    assert.deepEqual(
      parseFootnote(String.raw`+ \fr 1.1 \ft Primeira. \fp Segunda parte.\f*`),
      [
        { type: "footnote", text: "Primeira.", reference: "1.1" },
        { type: "footnote", text: "Segunda parte.", reference: "" },
      ],
    )
    assert.deepEqual(parseFootnote(String.raw`+ \ft Sem referência.\f*`), [
      { type: "footnote", text: "Sem referência.", reference: "" },
    ])
    // A decorative \ft before the reference does not hide the note.
    assert.deepEqual(
      parseFootnote(String.raw`+ \ft ❑ \fr 7. \ft Ver Lc 4,18.\f*`),
      [{ type: "footnote", text: "Ver Lc 4,18.", reference: "7." }],
    )
    assert.deepEqual(parseFootnote(String.raw`+ \fr 1.1 \f*`), [])
  })

  it("stores each kind of verse object", async () => {
    const fake = createFakeRedis()

    const verse = await storeVerse(fake.client, "gen", 1, 1, 1, "1", [
      { type: "text", text: "Texto*\n" },
      { type: "quote", tag: "q2", text: "Citação" },
      { type: "paragraph", tag: "p", nextChar: "\n" },
      { type: "section", tag: "s1", content: "Título" },
      { type: "section", tag: "ms", content: "LIVRO I" },
      { type: "section", tag: "r", content: "(Mt 1,1)" },
      { tag: "r", content: "(Mc 1,1)" },
      { tag: "f", content: String.raw`+ \fr 1.1 \ft Nota.\f*` },
    ] as unknown as USFMVerseObject[])

    assert.deepEqual(
      verse.text.map((part) => [part.type, part.text]),
      [
        ["text", "Texto"],
        ["quote", "Citação"],
        ["paragraph", "\n"],
        ["section", "Título"],
        ["section", "LIVRO I"],
        ["section", "(Mt 1,1)"],
        ["references", "(Mc 1,1)"],
        ["footnote", "Nota."],
      ],
    )
    assert.equal(fake.strings.get("chapterTitle:gen:1"), "Título")
  })
})

describe("retryFailedEmbeddings", () => {
  it("re-embeds recorded chapters and clears them", async () => {
    const fake = await fakeBible()
    await fake.client.sAdd(EMBEDDING_FAILURES_KEY, "gen:1")
    stub.respondWith(reversedVectors)

    assert.equal(await retryFailedEmbeddings(fake.client), 0)
    for (const n of [1, 2, 3]) {
      assert.ok(fake.strings.has(`embedding:gen:1:${n}`), `verse ${n}`)
    }
  })

  it("drops a chapter that cannot be read back", async () => {
    const fake = await fakeBible()
    await fake.client.sAdd(EMBEDDING_FAILURES_KEY, "gen:3")

    assert.equal(await retryFailedEmbeddings(fake.client), 0)
  })

  it("keeps failing chapters and stops after three in a row", async () => {
    const fake = await fakeBible()
    for (const member of ["gen:1", "gen:2", "gen:1", "gen:2"]) {
      await fake.client.sAdd(EMBEDDING_FAILURES_KEY, member)
    }
    for (let n = 4; n <= 6; n++) {
      await fake.client.set(`chapterVerseMax:gen:${n}`, "1")
      await setJson(fake.client, verseKey("gen", n, 1), {
        bookId: "gen",
        chapterNumber: n,
        number: 1,
        numberLabel: "1",
        searchId: "",
        text: [{ type: "text", text: "x", normalizedText: "x" }],
      })
      await fake.client.sAdd(EMBEDDING_FAILURES_KEY, `gen:${n}`)
    }
    stub.respondWith(errorResponse(400))
    const before = stub.requests.length

    assert.equal(await retryFailedEmbeddings(fake.client), 5)
    assert.equal(stub.requests.length - before, 3)
  })
})
