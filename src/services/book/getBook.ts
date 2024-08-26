import type { createClient } from "redis"
import { getChapter } from "../chapter/getChapter"
//import { getChapterOnlySections } from "../chapter/getChapterOnlySections"

export const getBook = async (
  client: ReturnType<typeof createClient>,
  bookId: Book["id"],
  getChapters = false,
): Promise<Book | null> => {
  const bookText = await client.get(`book:${bookId}`)

  if (!bookText) return null

  const book: Book = JSON.parse(bookText)

  book.chapters = []

  if (getChapters) {
    for (let i = 1; i <= book.chapterCount; i++) {
      book.chapters.push(await getChapter(client, bookId, i))
    }
  } else {
    //for (let i = 1; i <= book.chapterCount; i++) {
      //book.chapters.push(await getChapterOnlySections(client, bookId, i))
    //}
  }
  return book
}
