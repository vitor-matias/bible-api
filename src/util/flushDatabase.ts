import {
  RedisSearchLanguages,
  SchemaFieldTypes,
  VectorAlgorithms,
  createClient,
} from "redis"

export const flushDatabase = async () => {
  const client = createClient({ url: process.env.DB_URL })
  await client.connect()
  await client.flushAll()

  await client.ft.create(
    "idx:verseText",
    {
      "$.text[*].text": {
        type: SchemaFieldTypes.TEXT,
        AS: "text",
      },
    },
    {
      ON: "JSON",
      PREFIX: "verse:",
      LANGUAGE: RedisSearchLanguages.PORTUGUESE,
    },
  )

  await client.ft.create(
    "idx:verseEmbedding",
    {
      "$.embedding": {
        type: SchemaFieldTypes.VECTOR,
        ALGORITHM: VectorAlgorithms.FLAT, // or "FLAT" depending on your use case
        TYPE: "FLOAT32", // type of the vector elements (can be FLOAT32 or FLOAT64)
        DIM: 384, // dimension of the vectors
        DISTANCE_METRIC: "COSINE", // or "L2" or "IP" depending on how you want to calculate similarity
        AS: "embedding",
      },
    },
    {
      ON: "JSON",
      PREFIX: "embedding:",
      LANGUAGE: RedisSearchLanguages.PORTUGUESE,
    },
  )

  await client.quit()
}
