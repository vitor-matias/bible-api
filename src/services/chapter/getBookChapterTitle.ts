import type { createClient } from "redis"

export const chapterTitleKey = (
  bookId: Book["id"],
  chapterNumber: Chapter["number"],
): string => `chapterTitle:${bookId}:${chapterNumber}`

export const getBookChapterTitle = async (
  client: ReturnType<typeof createClient>,
  bookId: Book["id"],
  chapterNumber: Chapter["number"],
): Promise<Chapter> => {
  const chapterTitle = await client.get(chapterTitleKey(bookId, chapterNumber))

  return {
    title: chapterTitle || "",
    number: chapterNumber,
    bookId,
  }
}
