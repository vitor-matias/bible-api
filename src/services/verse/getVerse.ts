import type { createClient } from "redis"

export const getVerse = async (
  client: ReturnType<typeof createClient>,
  bookId: Book["id"],
  chapterNumber: Chapter["number"],
  verseNumber: Verse["number"],
): Promise<Verse> => {
  return getVerseByKey(
    client,
    `verse:${bookId}:${chapterNumber}:${verseNumber}`,
  )
}

export const getVerseByKey = async (
  client: ReturnType<typeof createClient>,
  key: string,
): Promise<Verse> => {
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  const result: any = await client.json.get(key)
  if (!result) {
    return result as Verse
  }
  const verseData = result

  return verseData as Verse
}
