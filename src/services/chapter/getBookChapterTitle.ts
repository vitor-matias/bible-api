import type { createClient } from "redis"

export const getBookChapterTitle = async (
  client: ReturnType<typeof createClient>,
  bookId: Book["id"],
  chapterNumber: Chapter["number"],
): Promise<Chapter> => {
  const chapterTitle = await client.get(
    `chapterTitle:${bookId}:${chapterNumber}`,
  )

  return {
    title: chapterTitle || "",
    number: chapterNumber,
    bookId,
  }
}
