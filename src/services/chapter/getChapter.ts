import type { createClient } from "redis"

export const getChapter = async (
  client: ReturnType<typeof createClient>,
  bookId: Book["id"],
  chapterNumber: Chapter["number"],
): Promise<Chapter> => {
  const versesToFetch = await client.keys(`verse:${bookId}:${chapterNumber}:*`)
  const verses: Verse[] = []

  if (versesToFetch.length === 0) {
    throw new Error("Not Found")
  }

  for (const key of versesToFetch) {
    const verseData = await client.json.get(key)
    const verse = verseData ? (verseData as Verse) : null

    if (verse) {
      verses[verse.number] = verse
    }
  }

  return { bookId, number: chapterNumber, verses }
}
