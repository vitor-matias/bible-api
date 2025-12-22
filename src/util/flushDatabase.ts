import { createClient } from "redis"

export const flushDatabase = async () => {
  const client = createClient({ url: process.env.DB_URL })
  await client.connect()
  await client.flushAll()

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

  await client.ft.create(
    "idx:verseEmbeddings",
    {
      "$.key": {
        type: "TEXT",
        AS: "key",
      },
      "$.embedding": {
        type: "VECTOR",
        AS: "embedding",
        ALGORITHM: "HNSW",
        TYPE: "FLOAT32",
        DIM: 1536, // Dimension for text-embedding-3-small
        DISTANCE_METRIC: "COSINE",
      },
    },
    {
      ON: "JSON",
      PREFIX: "embedding:",
    },
  )

  await client.quit()
}
