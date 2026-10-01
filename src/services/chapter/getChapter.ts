import type { createClient } from "redis"
import { NotFoundError } from "../../util/errors"
import { verseKey } from "../verse/getVerse"
import { getBookChapterTitle } from "./getBookChapterTitle"
import { chapterVerseMaxKey, MAX_CHAPTER_VERSES } from "./verseCountKey"

export const getChapter = async (
  client: ReturnType<typeof createClient>,
  bookId: Book["id"],
  chapterNumber: Chapter["number"],
  // Bulk callers fetch every title for the book in one MGET and pass it in,
  // which avoids a per-chapter round trip here.
  knownTitle?: string,
): Promise<Chapter> => {
  if (!Number.isInteger(chapterNumber)) {
    throw new NotFoundError()
  }

  // The import records the chapter's highest verse number, so the verse keys
  // can be addressed directly. Scanning for them instead walked the entire
  // keyspace once per chapter, which /v1/books?withChapters=true multiplies by
  // every chapter of every book.
  const maxVerseNumber = await client.get(
    chapterVerseMaxKey(bookId, chapterNumber),
  )

  // parseInt would accept "2junk", and isInteger accepts unsafe integers, so a
  // corrupt marker could drive the loop below to an absurd key count.
  const highestVerse =
    maxVerseNumber !== null && /^\d+$/.test(maxVerseNumber)
      ? Number(maxVerseNumber)
      : Number.NaN

  if (
    !Number.isSafeInteger(highestVerse) ||
    highestVerse > MAX_CHAPTER_VERSES
  ) {
    throw new NotFoundError()
  }

  // Verses are numbered from 0 (the "front" pseudo-verse) up to the recorded
  // maximum; json.mGet returns null for any gap, which is filtered out below.
  const versesToFetch: string[] = []
  for (let number = 0; number <= highestVerse; number++) {
    versesToFetch.push(verseKey(bookId, chapterNumber, number))
  }

  // One round trip for the whole chapter, issued alongside the title lookup
  // rather than before it. With the "$" path each entry comes back as a
  // single-element array (or null for missing keys).
  const [versesData, title] = await Promise.all([
    client.json.mGet(versesToFetch, "$"),
    knownTitle !== undefined
      ? Promise.resolve(knownTitle)
      : getBookChapterTitle(client, bookId, chapterNumber).then(
          (chapter) => chapter.title ?? "",
        ),
  ])

  // Indexed by verse number, as the endpoint has always returned it: verses[n]
  // is verse n, and a gap (or a missing verse 0) is a hole serialized as null.
  const verses: Verse[] = []
  let found = 0
  for (const doc of versesData) {
    const verse = (doc as unknown as Verse[] | null)?.[0]
    if (verse) {
      verses[verse.number] = verse
      found++
    }
  }

  if (found === 0) {
    throw new NotFoundError()
  }

  return { bookId, number: chapterNumber, verses, title }
}
