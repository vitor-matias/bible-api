import type { createClient } from "redis"
import { NotFoundError } from "../../util/errors"
import { verseKey } from "../verse/getVerse"
import { getBookChapterTitle } from "./getBookChapterTitle"
import { chapterVerseMaxKey } from "./verseCountKey"

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

  const highestVerse =
    maxVerseNumber === null ? Number.NaN : Number.parseInt(maxVerseNumber, 10)

  if (!Number.isInteger(highestVerse) || highestVerse < 0) {
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

  return { bookId, number: chapterNumber, verses, title }
}
