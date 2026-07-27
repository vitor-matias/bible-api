import type { createClient } from "redis"
import { getBookChapterTitle } from "../chapter/getBookChapterTitle"
import { getChapter } from "../chapter/getChapter"

export const getBook = async (
  client: ReturnType<typeof createClient>,
  bookId: Book["id"],
  getChapters = false,
): Promise<Book | null> => {
  const book = (await client.json.get(`book:${bookId}`)) as Book | null

  if (!book) return null

  const chapterNumbers = Array.from(
    { length: book.chapterCount },
    (_, i) => i + 1,
  )

  const chapters = await Promise.all(
    chapterNumbers.map((chapterNumber) =>
      getChapters
        ? getChapter(client, bookId, chapterNumber)
        : getBookChapterTitle(client, bookId, chapterNumber),
    ),
  )

  book.chapters = chapters.filter(
    (chapter): chapter is Chapter => chapter != null,
  )

  return book
}
