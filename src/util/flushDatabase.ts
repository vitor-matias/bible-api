import { createClient } from "redis"

export const flushDatabase = async () => {
  const client = createClient({ url: process.env.DB_URL })
  client.on("error", (err) => console.error(`Redis client error: ${err}`))
  await client.connect()
  try {
    // flushDb only clears the current logical DB, unlike flushAll which wipes
    // every DB on the (possibly shared) Redis instance.
    await client.flushDb()

    await client.ft.create(
      "idx:verseText",
      {
        "$.text[*].text": {
          type: "TEXT",
          AS: "text",
        },
        "$.text[*].normalizedText": {
          type: "TEXT",
          AS: "normalizedText",
        },
        "$.searchId": {
          type: "TEXT",
          AS: "searchId",
        },
        "$.number": {
          type: "NUMERIC",
          AS: "number",
        },
      },
      {
        ON: "JSON",
        PREFIX: "verse:",
        LANGUAGE: "Portuguese",
      },
    )

    // Hashes, not JSON: a vector is stored as its raw float32 bytes (see
    // storeChapter). The "key" field is only returned by queries, never
    // searched, so it stays out of the schema.
    await client.ft.create(
      "idx:verseEmbeddings",
      {
        embedding: {
          type: "VECTOR",
          ALGORITHM: "HNSW",
          TYPE: "FLOAT32",
          DIM: 1536, // Dimension for text-embedding-3-small
          DISTANCE_METRIC: "COSINE",
        },
      },
      {
        ON: "HASH",
        PREFIX: "embedding:",
      },
    )
  } finally {
    await client.quit()
  }
}
