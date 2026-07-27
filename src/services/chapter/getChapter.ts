import type { createClient } from "redis"

export const getChapter = async (
  client: ReturnType<typeof createClient>,
  bookId: Book["id"],
  chapterNumber: Chapter["number"],
): Promise<Chapter | null> => {
  const meta = (await client.json.get(
    `chapter:${bookId}:${chapterNumber}`,
  )) as ChapterMeta | null

  if (!meta) {
    return null
  }

  // Verse numbers are sequential (0 = front matter), so fetch them directly
  // instead of discovering keys with a blocking KEYS scan
  const results = await Promise.all(
    Array.from({ length: meta.lastVerse + 1 }, (_, verseNumber) =>
      client.json.get(`verse:${bookId}:${chapterNumber}:${verseNumber}`),
    ),
  )

  const verses: Verse[] = []
  for (const result of results) {
    if (result) {
      const verse = result as unknown as Verse
      verses[verse.number] = verse
    }
  }

  const chapterTitle = await client.get(
    `chapterTitle:${bookId}:${chapterNumber}`,
  )

  return { bookId, number: chapterNumber, verses, title: chapterTitle || "" }
}
