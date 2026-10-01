import type { createClient } from "redis"

export const verseKey = (
  bookId: Book["id"],
  chapterNumber: Chapter["number"],
  verseNumber: Verse["number"],
): string => `verse:${bookId}:${chapterNumber}:${verseNumber}`

export const getVerse = async (
  client: ReturnType<typeof createClient>,
  bookId: Book["id"],
  chapterNumber: Chapter["number"],
  verseNumber: Verse["number"],
): Promise<Verse | null> => {
  return getVerseByKey(client, verseKey(bookId, chapterNumber, verseNumber))
}

export const getVerseByKey = async (
  client: ReturnType<typeof createClient>,
  key: string,
): Promise<Verse | null> => {
  const result = await client.json.get(key)

  if (!result) {
    return null
  }
  const verseData = result

  return verseData as Verse
}
