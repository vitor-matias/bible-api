import type { createClient } from "redis"

export const getChapterOnlySections = async (
  client: ReturnType<typeof createClient>,
  bookId: Book["id"],
  chapterNumber: Chapter["number"],
): Promise<Chapter> => {
  const versesToFetch = await client.keys(`verse:${bookId}:${chapterNumber}:*`)
  const verses: Verse[] = []

  for (const key of versesToFetch) {
    const verse = await client.get(key)

    if (verse) {
      const verseObject: Verse = JSON.parse(verse)

      verseObject.text = verseObject.text.filter(
        (text) => text.type === "section",
      )

      if (verseObject.text.length > 0) {
        verses.push(verseObject)
      }
    }
  }

  return { bookId, number: chapterNumber, verses }
}
