import type { createClient } from "redis"
import { getChapter } from "../chapter/getChapter"
import {
  collectForEmbedding,
  EMBEDDING_FAILURES_KEY,
  embedAndStoreVerses,
  type VerseForEmbedding,
} from "./storeChapter"

// Retrying stops after this many chapters in a row fail: that is an outage or
// a bad key, and hammering the API for every remaining chapter would not help.
const MAX_CONSECUTIVE_RETRY_FAILURES = 3

// Re-embeds only the chapters recorded as failed, reading their verses back
// from Redis. Returns how many chapters still lack embeddings afterwards.
export const retryFailedEmbeddings = async (
  client: ReturnType<typeof createClient>,
): Promise<number> => {
  const failed = await client.sMembers(EMBEDDING_FAILURES_KEY)
  let consecutiveFailures = 0

  for (const member of failed) {
    if (consecutiveFailures >= MAX_CONSECUTIVE_RETRY_FAILURES) break

    const separator = member.lastIndexOf(":")
    const bookId = member.slice(0, separator)
    const chapterNumber = Number(member.slice(separator + 1))

    try {
      const chapter = await getChapter(client, bookId, chapterNumber)
      const versesData: VerseForEmbedding[] = []
      for (const verse of chapter.verses ?? []) {
        if (verse) collectForEmbedding(versesData, verse, verse.number)
      }

      if (versesData.length > 0) {
        await embedAndStoreVerses(client, versesData)
      }
      await client.sRem(EMBEDDING_FAILURES_KEY, member)
      consecutiveFailures = 0
    } catch (error) {
      consecutiveFailures++
      console.error(`Retrying embeddings for ${member} failed:`, error)
    }
  }

  return client.sCard(EMBEDDING_FAILURES_KEY)
}
