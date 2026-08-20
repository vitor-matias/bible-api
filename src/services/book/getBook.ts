import type { createClient } from "redis"
import { NotFoundError } from "../../util/errors"
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
    chapterNumbers.map(async (chapterNumber) => {
      if (!getChapters) {
        return getBookChapterTitle(client, bookId, chapterNumber)
      }

      try {
        return await getChapter(client, bookId, chapterNumber)
      } catch (error) {
        // A chapter that is simply absent is dropped by the filter below;
        // Promise.all would otherwise reject and fail the whole book. Any
        // other error is operational and must still surface.
        if (error instanceof NotFoundError) return null
        throw error
      }
    }),
  )

  book.chapters = chapters.filter(
    (chapter): chapter is Chapter => chapter != null,
  )

  return book
}
