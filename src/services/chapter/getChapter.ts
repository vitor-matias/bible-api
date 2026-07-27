import type { createClient } from "redis"
import { NotFoundError } from "../../util/errors"

// Book ids come from USFM id headers (e.g. "gen", "1co"); restrict to
// alphanumerics so they can't inject glob metacharacters into the SCAN pattern.
const BOOK_ID_PATTERN = /^[a-z0-9]+$/

export const getChapter = async (
  client: ReturnType<typeof createClient>,
  bookId: Book["id"],
  chapterNumber: Chapter["number"],
): Promise<Chapter> => {
  if (!BOOK_ID_PATTERN.test(bookId) || !Number.isInteger(chapterNumber)) {
    throw new NotFoundError()
  }

  // SCAN is non-blocking, unlike KEYS which scans the whole keyspace at once.
  const versesToFetch: string[] = []
  for await (const keys of client.scanIterator({
    MATCH: `verse:${bookId}:${chapterNumber}:*`,
    COUNT: 100,
  })) {
    versesToFetch.push(...keys)
  }

  if (versesToFetch.length === 0) {
    throw new NotFoundError()
  }

  // One round trip for the whole chapter. With the "$" path each entry comes
  // back as a single-element array (or null for missing keys).
  const versesData = await client.json.mGet(versesToFetch, "$")
  const verses: Verse[] = []
  for (const doc of versesData) {
    const verse = (doc as unknown as Verse[] | null)?.[0]
    if (verse) {
      verses.push(verse)
    }
  }

  verses.sort((a, b) => a.number - b.number)

  const chapterTitle = await client.get(
    `chapterTitle:${bookId}:${chapterNumber}`,
  )

  return { bookId, number: chapterNumber, verses, title: chapterTitle || "" }
}
