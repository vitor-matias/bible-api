import type { createClient } from "redis"

// Only this app's keys — never FLUSHALL, the Redis instance may hold other data
const APP_KEY_PATTERNS = [
  "book:*",
  "verse:*",
  "chapter:*",
  "chapterTitle:*",
  "cache:*",
  "books",
]

export const flushDatabase = async (
  client: ReturnType<typeof createClient>,
) => {
  try {
    await client.ft.dropIndex("idx:verseText")
  } catch {
    // Index does not exist yet
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
}
