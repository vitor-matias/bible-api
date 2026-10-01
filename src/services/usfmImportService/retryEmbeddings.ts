import type { createClient } from "redis"
import { NotFoundError } from "../../util/errors"
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

// Re-embeds one recorded chapter, reading its verses back from Redis. Returns
// false (after logging) when any step fails transiently.
const retryChapter = async (
  client: ReturnType<typeof createClient>,
  member: string,
): Promise<boolean> => {
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
    return true
  } catch (error) {
    // A chapter that cannot be read back can never be re-embedded, and left in
    // the set it would keep semantic search disabled until a full reimport.
    // It has no readable verses for semantic search to miss, so drop it.
    if (error instanceof NotFoundError) {
      console.warn(
        `Chapter ${member} cannot be read back; dropping it from the embedding retry set.`,
      )
      await client.sRem(EMBEDDING_FAILURES_KEY, member)
      return true
    }
    console.error(`Retrying embeddings for ${member} failed:`, error)
    return false
  }
}

// Re-embeds only the chapters recorded as failed. Returns how many chapters
// still lack embeddings afterwards.
export const retryFailedEmbeddings = async (
  client: ReturnType<typeof createClient>,
): Promise<number> => {
  const failed = await client.sMembers(EMBEDDING_FAILURES_KEY)
  let consecutiveFailures = 0

  for (const member of failed) {
    if (consecutiveFailures >= MAX_CONSECUTIVE_RETRY_FAILURES) break

    // Sequential on purpose: the loop must stop after repeated failures
    // instead of firing an OpenAI request for every remaining chapter.
    const retried = await retryChapter(client, member) // NOSONAR
    consecutiveFailures = retried ? 0 : consecutiveFailures + 1
  }

  return client.sCard(EMBEDDING_FAILURES_KEY)
}
