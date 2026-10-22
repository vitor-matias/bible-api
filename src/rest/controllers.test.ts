import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { Request, Response } from "express"
import { fakeBible } from "../testing/bibleFixture"
import { fakeRequest, fakeResponse } from "../testing/fakeExpress"
import { createFakeRedis } from "../testing/fakeRedis"
import { setImportState } from "../util/importState"
import { getBookController } from "./book"
import { getBooksController } from "./books"
import { getChapterController } from "./chapter"
import { getIntroController, getIntrosController } from "./intros"
import { searchVersesController } from "./search"
import { getVerseController, getVersesController } from "./verses"

type Controller = (req: Request, res: Response) => Promise<unknown>
type Client = ReturnType<typeof createFakeRedis>["client"]

const call = async (
  controller: Controller,
  client: Client,
  request: Parameters<typeof fakeRequest>[0],
  locals: Record<string, unknown> = {},
) => {
  const { res, sent } = fakeResponse({ client, ...locals })
  await controller(fakeRequest(request), res)
  return sent
}

const numbers = (body: unknown) => (body as Verse[]).map((v) => v.number)

describe("getVerseController", () => {
  it("returns a stored verse and 404s otherwise", async () => {
    const { client } = await fakeBible()
    const params = { book: "gen", chapter: "1" }

    const found = await call(getVerseController, client, {
      params: { ...params, verse: "2" },
    })
    assert.equal((found.body as Verse).number, 2)

    for (const verse of ["9", "02", "x"]) {
      const sent = await call(getVerseController, client, {
        params: { ...params, verse },
      })
      assert.equal(sent.status, 404, verse)
    }
  })
})

describe("getVersesController", () => {
  const range = (chapter: string, startVerse: string, endVerse: string) => ({
    params: { book: "gen", chapter, startVerse, endVerse },
  })

  it("returns the leading run of existing verses in the range", async () => {
    const { client } = await fakeBible()

    const sent = await call(getVersesController, client, range("1", "1", "9"))

    assert.deepEqual(numbers(sent.body), [1, 2, 3])
  })

  it("404s for a range that starts on a missing verse or is malformed", async () => {
    const { client } = await fakeBible()

    for (const params of [
      range("2", "0", "2"),
      range("1", "3", "2"),
      range("x", "1", "2"),
      range("1", "a", "2"),
    ]) {
      const sent = await call(getVersesController, client, params)
      assert.equal(sent.status, 404, JSON.stringify(params))
    }
  })

  it("rejects ranges longer than any chapter", async () => {
    const { client } = await fakeBible()

    const sent = await call(getVersesController, client, range("1", "1", "201"))

    assert.equal(sent.status, 400)
  })
})

describe("getChapterController", () => {
  it("returns a chapter, 404s a missing one and 500s a failure", async () => {
    const { client } = await fakeBible()

    const found = await call(getChapterController, client, {
      params: { book: "gen", chapter: "1" },
    })
    assert.equal((found.body as Chapter).title, "A criação")

    for (const chapter of ["3", "01"]) {
      const sent = await call(getChapterController, client, {
        params: { book: "gen", chapter },
      })
      assert.deepEqual(sent, {
        status: 404,
        body: { error: "Chapter not found" },
      })
    }

    Object.assign(client, {
      get: async () => {
        throw new Error("connection lost")
      },
    })
    const failed = await call(getChapterController, client, {
      params: { book: "gen", chapter: "1" },
    })
    assert.deepEqual(failed, {
      status: 500,
      body: { error: "Internal server error" },
    })
  })
})

describe("getBookController / getBooksController", () => {
  it("returns one book with titles, or with verses when asked", async () => {
    const { client } = await fakeBible()

    const titles = await call(getBookController, client, {
      params: { book: "gen" },
    })
    assert.equal((titles.body as Book).chapters?.length, 3)

    const full = await call(getBookController, client, {
      params: { book: "gen" },
      query: { withVerses: "true" },
    })
    assert.ok((full.body as Book).chapters?.[0].verses)

    const missing = await call(getBookController, client, {
      params: { book: "xyz" },
    })
    assert.equal(missing.status, 404)
  })

  it("lists every book", async () => {
    const { client } = await fakeBible()

    const plain = await call(getBooksController, client, {})
    const full = await call(getBooksController, client, {
      query: { withChapters: "true" },
    })

    assert.deepEqual(
      (plain.body as Book[]).map((book) => book.id),
      ["gen"],
    )
    assert.equal((full.body as Book[])[0].chapters?.length, 2)
  })
})

describe("getIntroController / getIntrosController", () => {
  it("lists introductions and returns one by slug", async () => {
    const { client } = createFakeRedis()
    await client.rPush("intros", "geral")
    await client.json.set("intro:geral", "$", {
      slug: "geral",
      name: "Introdução geral",
      introduction: [],
    })

    const list = await call(getIntrosController, client, {})
    assert.deepEqual(list.body, [{ slug: "geral", name: "Introdução geral" }])

    const one = await call(getIntroController, client, {
      params: { slug: "geral" },
    })
    assert.equal((one.body as BookIntro).name, "Introdução geral")

    for (const slug of ["outra", "Geral", "a:b"]) {
      const sent = await call(getIntroController, client, { params: { slug } })
      assert.equal(sent.status, 404, slug)
    }
  })
})

describe("searchVersesController", () => {
  const verseHit = (number: number) => ({
    id: `verse:gen:1:${number}`,
    value: { number },
  })

  it("runs an escaped phrase search on the normalized text", async () => {
    const queries: string[] = []
    const { client } = createFakeRedis((_index, query) => {
      queries.push(query)
      return { total: 2, documents: [verseHit(1), verseHit(2)] }
    })

    const sent = await call(
      searchVersesController,
      client,
      { query: { text: ' Ação "x" ', page: "1", limit: "10" } },
      { searchText: 'Ação "x"' },
    )

    assert.deepEqual(queries, [
      String.raw`@normalizedText: "acao \"x\"" @number:[1 +inf]`,
    ])
    assert.deepEqual(sent.body, {
      verses: [{ number: 1 }, { number: 2 }],
      total: 2,
      currentPage: 1,
      totalPages: 1,
    })
  })

  it("answers past the last page with no verses, and 500s a failed search", async () => {
    const { client } = createFakeRedis(() => ({ total: 2, documents: [] }))

    const past = await call(searchVersesController, client, {
      query: { text: "amor", page: "3", limit: "1" },
    })
    assert.deepEqual(past.body, {
      verses: [],
      total: 2,
      currentPage: 3,
      totalPages: 2,
    })

    const failing = createFakeRedis(() => {
      throw new Error("syntax error")
    })
    const failed = await call(searchVersesController, failing.client, {
      query: { text: "amor" },
    })
    assert.deepEqual(failed, { status: 500, body: { error: "Search failed" } })
  })

  it("refuses semantic search while the index is incomplete or past its window", async () => {
    const { client } = createFakeRedis()

    setImportState("degraded")
    const degraded = await call(searchVersesController, client, {
      query: { text: "amor", semantic: "true" },
    })
    assert.equal(degraded.status, 503)

    setImportState("ready")
    const beyond = await call(searchVersesController, client, {
      query: { text: "amor", semantic: "true", page: "11", limit: "10" },
    })
    assert.equal(beyond.status, 400)
  })

  it("500s when the query cannot be embedded", async () => {
    const { client } = createFakeRedis()
    delete process.env.VOYAGE_API_KEY
    setImportState("ready")

    const sent = await call(searchVersesController, client, {
      query: { text: "amor", semantic: "true" },
    })

    assert.deepEqual(sent, {
      status: 500,
      body: { error: "Semantic search failed" },
    })
  })
})
