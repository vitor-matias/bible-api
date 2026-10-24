import assert from "node:assert/strict"
import { after, before, describe, it } from "node:test"
import {
  errorResponse,
  reversedVectors,
  startVoyageStub,
} from "../../testing/voyageStub"
import { getEmbeddingDimensions } from "../../util/vectorBuffer"
import { generateChapterEmbeddings, generateQueryEmbedding } from "./embeddings"

// The size is configurable (EMBEDDING_DIMENSIONS), so the tests follow it.
const DIMENSIONS = getEmbeddingDimensions()

let stub: Awaited<ReturnType<typeof startVoyageStub>>

before(async () => {
  stub = await startVoyageStub()
})

after(async () => {
  await stub.close()
})

// The client is built once, on first use, so the configuration checks run
// before any test points it at the stub.
describe("client configuration", () => {
  it("requires VOYAGE_API_KEY", async () => {
    delete process.env.VOYAGE_API_KEY
    await assert.rejects(generateQueryEmbedding("ping"), /VOYAGE_API_KEY/)
  })

  it("refuses a plain-HTTP base URL outside localhost", async () => {
    process.env.VOYAGE_API_KEY = "al-test"
    process.env.VOYAGE_BASE_URL = "http://api.example.com/v1"
    await assert.rejects(generateQueryEmbedding("ping"), /must use https/)
  })

  it("refuses a base URL that is not a URL", async () => {
    process.env.VOYAGE_BASE_URL = "not a url"
    await assert.rejects(generateQueryEmbedding("ping"), /not a valid URL/)
  })
})

describe("generateChapterEmbeddings", () => {
  before(() => {
    process.env.VOYAGE_BASE_URL = stub.url
  })

  it("sends the chapter as one document and returns a vector per verse", async () => {
    stub.requests.length = 0
    stub.respondWith(reversedVectors)
    const vectors = await generateChapterEmbeddings([
      { text: "Evangelho de São Lucas, capítulo 10", embed: false },
      { text: "Respondeste bem", embed: true },
      { text: "Parábola do bom samaritano", embed: false },
      { text: "   ", embed: true },
      { text: "", embed: false },
      { text: " E quem é o meu próximo? ", embed: true },
    ])

    assert.equal(stub.requests.length, 1)
    assert.equal(stub.requests[0].url, "/v1/contextualizedembeddings")
    assert.deepEqual(stub.requests[0].body, {
      model: "voyage-context-4",
      output_dimension: DIMENSIONS,
      input_type: "document",
      inputs: [
        [
          "Evangelho de São Lucas, capítulo 10",
          "Respondeste bem",
          "Parábola do bom samaritano",
          "E quem é o meu próximo?",
        ],
      ],
    })
    // One entry per verse chunk: context chunks get none, and the blank verse
    // keeps its slot without being sent.
    assert.equal(vectors.length, 3)
    assert.equal(vectors[0].length, DIMENSIONS)
    assert.equal(vectors[0][0], "Respondeste bem".length)
    assert.deepEqual(vectors[1], [])
    assert.equal(vectors[2][0], "E quem é o meu próximo?".length)
  })

  it("leaves a verse empty when the response lacks its chunk", async () => {
    stub.respondWith((body, res) => {
      // Only the first chunk comes back.
      const dimension = body.output_dimension as number
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        JSON.stringify({
          object: "list",
          data: [
            {
              index: 0,
              data: [{ index: 0, embedding: new Array(dimension).fill(1) }],
            },
          ],
        }),
      )
    })
    const vectors = await generateChapterEmbeddings([
      { text: "um", embed: true },
      { text: "dois", embed: true },
    ])
    assert.equal(vectors[0].length, DIMENSIONS)
    assert.deepEqual(vectors[1], [])
  })

  it("makes no request when there is nothing to embed", async () => {
    stub.requests.length = 0
    assert.deepEqual(await generateChapterEmbeddings([]), [])
    assert.deepEqual(
      await generateChapterEmbeddings([
        { text: "só contexto", embed: false },
        { text: "  ", embed: true },
      ]),
      [[]],
    )
    assert.equal(stub.requests.length, 0)
  })

  it("reports an API error", async () => {
    stub.respondWith(errorResponse(400))
    await assert.rejects(
      generateChapterEmbeddings([{ text: "um", embed: true }]),
      /Failed to generate embeddings/,
    )
  })
})

describe("generateQueryEmbedding", () => {
  before(() => {
    process.env.VOYAGE_BASE_URL = stub.url
  })

  it("embeds a query as a single-chunk document", async () => {
    stub.requests.length = 0
    stub.respondWith(reversedVectors)
    const vector = await generateQueryEmbedding("Jesus acalma a tempestade")
    assert.equal(vector.length, DIMENSIONS)
    assert.deepEqual(stub.requests[0].body, {
      model: "voyage-context-4",
      output_dimension: DIMENSIONS,
      input_type: "query",
      inputs: [["Jesus acalma a tempestade"]],
    })
  })

  it("rejects an empty query without calling the API", async () => {
    stub.requests.length = 0
    await assert.rejects(generateQueryEmbedding("   "), /cannot be empty/)
    assert.equal(stub.requests.length, 0)
  })

  it("rejects a response without a vector", async () => {
    stub.respondWith((_body, res) => {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ object: "list", data: [] }))
    })
    await assert.rejects(
      generateQueryEmbedding("ping"),
      /Embedding response contained no vector/,
    )
  })
})
