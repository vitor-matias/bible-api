import { createClient } from "redis"
import { createEmbeddingIndex } from "./embeddingIndex"

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

    await createEmbeddingIndex(client)
  } finally {
    await client.quit()
  }
}
