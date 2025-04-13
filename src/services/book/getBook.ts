import type { createClient } from "redis"
import { getBookChapterTitle } from "../chapter/getBookChapterTitle"
import { getChapter } from "../chapter/getChapter"

export const getBook = async (
  client: ReturnType<typeof createClient>,
  bookId: Book["id"],
  getChapters = false,
): Promise<Book | null> => {
  const book = (await client.json.get(`book:${bookId}`)) as Book

  if (!book) return null

  book.chapters = []

  if (getChapters) {
    for (let i = 1; i <= book.chapterCount; i++) {
      book.chapters.push(await getChapter(client, bookId, i))
    }
  } else {
    for (let i = 1; i <= book.chapterCount; i++) {
      book.chapters.push(await getBookChapterTitle(client, bookId, i))
    }
  }
  return book
}
