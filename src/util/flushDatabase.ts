import type { createClient } from "redis"

// Only this app's keys — never FLUSHALL, the Redis instance may hold other data
const APP_KEY_PATTERNS = [
  "book:*",
  "verse:*",
  "chapter:*",
  "chapterTitle:*",
  "embedding:*",
  "cache:*",
  "books",
]

const INDEXES = ["idx:verseText", "idx:verseEmbeddings"]

export const flushDatabase = async (
  client: ReturnType<typeof createClient>,
) => {
  for (const index of INDEXES) {
    try {
      await client.ft.dropIndex(index)
    } catch (error) {
      // Only "index does not exist yet" is expected; surface anything else
      const message = error instanceof Error ? error.message : String(error)
      if (!/unknown index name/i.test(message)) {
        throw error
      }
    }
  }

  for (const pattern of APP_KEY_PATTERNS) {
    for await (const keys of client.scanIterator({
      MATCH: pattern,
      COUNT: 500,
    })) {
      if (keys.length > 0) {
        await client.unlink(keys)
      }
    }
  }

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
}
