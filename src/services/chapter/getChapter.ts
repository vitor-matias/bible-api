import type { createClient } from "redis"
import { NotFoundError } from "../../util/errors"
import { getBookChapterTitle } from "./getBookChapterTitle"
import { chapterVerseMaxKey } from "./verseCountKey"

export const getChapter = async (
  client: ReturnType<typeof createClient>,
  bookId: Book["id"],
  chapterNumber: Chapter["number"],
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

  const highestVerse =
    maxVerseNumber === null ? Number.NaN : Number.parseInt(maxVerseNumber, 10)

  if (!Number.isInteger(highestVerse) || highestVerse < 0) {
    throw new NotFoundError()
  }

  // Verses are numbered from 0 (the "front" pseudo-verse) up to the recorded
  // maximum; json.mGet returns null for any gap, which is filtered out below.
  const versesToFetch: string[] = []
  for (let number = 0; number <= highestVerse; number++) {
    versesToFetch.push(`verse:${bookId}:${chapterNumber}:${number}`)
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

  if (verses.length === 0) {
    throw new NotFoundError()
  }

  verses.sort((a, b) => a.number - b.number)

  const { title } = await getBookChapterTitle(client, bookId, chapterNumber)

  return { bookId, number: chapterNumber, verses, title }
}
