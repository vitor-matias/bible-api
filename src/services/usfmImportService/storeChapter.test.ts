import assert from "node:assert/strict"
import { after, before, describe, it } from "node:test"
import * as usfm from "usfm-js"
import { createFakeRedis } from "../../testing/fakeRedis"
import {
  errorResponse,
  reversedVectors,
  startVoyageStub,
} from "../../testing/voyageStub"
import type { TaskPool } from "../../util/concurrency"
import { chapterOutlineKey } from "./chapterDocument"
import { EMBEDDING_FAILURES_KEY, storeChapter } from "./storeChapter"

// A chapter opening under one section, with another section that the parser
// attaches to the end of verse 2, and an empty \q1 that the import moves to
// the start of verse 4 as a zero-width space.
const LUKE_10 = String.raw`\id LUK
\toc1 Evangelho de São Lucas
\c 10
\s2 Missão dos setenta e dois discípulos
\p
\v 1 Depois disto, o Senhor designou outros setenta e dois discípulos.
\v 2 Disse-lhes:
\q1 «A messe é grande.»
\s2 Parábola do bom samaritano
\p
\v 3 Mas ele perguntou: «E quem é o meu próximo?»
\q1
\v 4 Jesus respondeu.
`

const chapter = () => usfm.toJSON(LUKE_10).chapters["10"]

// Collects the chapter's embedding task instead of running it, so a test can
// run it once the stub is set up.
const capturingPool = () => {
  const tasks: (() => Promise<void>)[] = []
  const pool: TaskPool = {
    submit: (task) => {
      tasks.push(task)
    },
    drain: async () => {},
  }
  return { pool, tasks }
}

const storeLuke10 = async () => {
  const fake = createFakeRedis()
  await fake.client.json.set("book:luk", "$", {
    id: "luk",
    name: "Evangelho de São Lucas",
  })
  const { pool, tasks } = capturingPool()
  await storeChapter(fake.client, "luk", 3, 10, chapter(), pool)
  return { fake, tasks }
}

let stub: Awaited<ReturnType<typeof startVoyageStub>>

before(async () => {
  stub = await startVoyageStub()
  process.env.VOYAGE_API_KEY = "al-test"
  process.env.VOYAGE_BASE_URL = stub.url
})

after(async () => {
  await stub.close()
})

describe("storeChapter", () => {
  it("stores the verses and the chapter's outline, and queues one embedding", async () => {
    const { fake, tasks } = await storeLuke10()

    for (const n of [0, 1, 2, 3, 4]) {
      assert.ok(fake.json.has(`verse:luk:10:${n}`), `verse ${n} stored`)
    }
    assert.equal(fake.strings.get("chapterVerseMax:luk:10"), "4")
    assert.deepEqual(fake.json.get(chapterOutlineKey("luk", 10)), {
      start: ["", "", "Missão dos setenta e dois discípulos", ""],
      end: ["", "", "Parábola do bom samaritano", ""],
    })
    assert.equal(tasks.length, 1)
  })

  it("embeds the chapter as one document, with its headings in place", async () => {
    const { fake, tasks } = await storeLuke10()
    stub.requests.length = 0
    stub.respondWith(reversedVectors)

    await tasks[0]()

    assert.equal(stub.requests.length, 1)
    assert.deepEqual(stub.requests[0].body.inputs, [
      [
        "Evangelho de São Lucas, capítulo 10: Missão dos setenta e dois discípulos",
        "Depois disto, o Senhor designou outros setenta e dois discípulos.",
        "Disse-lhes: «A messe é grande.»",
        "Parábola do bom samaritano",
        "Mas ele perguntou: «E quem é o meu próximo?»",
        // The zero-width space the import moved here is not sent.
        "Jesus respondeu.",
      ],
    ])
    for (const n of [1, 2, 3, 4]) {
      const hash = fake.hashes.get(`embedding:luk:10:${n}`)
      assert.ok(hash, `vector stored for verse ${n}`)
      assert.equal(hash.key, `verse:luk:10:${n}`)
      assert.equal((hash.embedding as Buffer).length, 1024 * 4)
    }
  })

  it("records the chapter for a retry when embedding fails", async () => {
    const { fake, tasks } = await storeLuke10()
    stub.respondWith(errorResponse(400))

    await tasks[0]()

    assert.deepEqual(
      [...(fake.sets.get(EMBEDDING_FAILURES_KEY) ?? [])],
      ["luk:10"],
    )
    assert.equal(fake.hashes.size, 0)
  })

  it("starts a verse at each \\va, labelled with the alternative number", async () => {
    // Zc 3:8-9 and 4:5-6 as the source prints them; Sir 51's litany indents
    // each lettered verse with the empty \q1 before its \va.
    const book = usfm.toJSON(String.raw`\id ZEC
\c 3
\v 7 Assim fala o Senhor.
\v 8-9 \va 9a\va* Porque eis a pedra.
\va 8\va* Ouve, pois, Josué.
\va 9b\va* E afastarei a iniquidade.
\v 10 Naquele dia.
\c 4
\v 5 Não, meu senhor.
\va 6a\va* Então ele \va \va*respondeu-me.
\q1
\va a\va* Louvai ao Senhor,
\q1 porque a sua misericórdia é eterna.
`)
    const fake = createFakeRedis()
    const { pool } = capturingPool()
    await storeChapter(fake.client, "zec", 38, 3, book.chapters["3"], pool)
    await storeChapter(fake.client, "zec", 38, 4, book.chapters["4"], pool)

    const verse = (c: number, n: number) =>
      fake.json.get(`verse:zec:${c}:${n}`) as Verse
    const texts = (v: Verse) => v.text.map((t) => t.text.trim())

    assert.deepEqual(
      [1, 2, 3, 4, 5].map((n) => verse(3, n).numberLabel),
      ["7", "9a", "8", "9b", "10"],
    )
    assert.deepEqual(texts(verse(3, 2)), ["Porque eis a pedra."])
    assert.equal(verse(4, 1).numberLabel, "5")
    assert.deepEqual(texts(verse(4, 1)), ["Não, meu senhor."])
    assert.equal(verse(4, 2).numberLabel, "6a")
    assert.equal(texts(verse(4, 2)).join(" "), "Então ele respondeu-me.")
    const litany = verse(4, 3)
    assert.equal(litany.numberLabel, "a")
    assert.equal(litany.text[0].type, "quote")
    assert.equal(litany.text[0].text, "​")
  })
})
