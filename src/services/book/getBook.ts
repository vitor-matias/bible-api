import type { createClient } from "redis"
import { mapWithConcurrency } from "../../util/concurrency"
import { NotFoundError } from "../../util/errors"
import { chapterTitleKey } from "../chapter/getBookChapterTitle"
import { getChapter } from "../chapter/getChapter"

// Caps how many chapters of one book are read at once. getBooksController fans
// out over books on top of this, so an unbounded Promise.all here would put
// every chapter of the whole Bible on the wire, and in heap, simultaneously.
const CHAPTER_CONCURRENCY = 8

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

  if (chapterNumbers.length === 0) {
    book.chapters = []
    return book
  }

  // Every title for the book in a single MGET, instead of one GET per chapter
  // on both the titles-only and the full-chapters path.
  const titles = await client.mGet(
    chapterNumbers.map((chapterNumber) =>
      chapterTitleKey(bookId, chapterNumber),
    ),
  )
  const titleAt = (index: number) => titles[index] ?? ""

  if (!getChapters) {
    book.chapters = chapterNumbers.map((chapterNumber, index) => ({
      bookId,
      number: chapterNumber,
      title: titleAt(index),
    }))
    return book
  }

  const chapters = await mapWithConcurrency(
    chapterNumbers,
    CHAPTER_CONCURRENCY,
    async (chapterNumber, index) => {
      try {
        return await getChapter(client, bookId, chapterNumber, titleAt(index))
      } catch (error) {
        // A chapter that is simply absent is dropped by the filter below;
        // Promise.all would otherwise reject and fail the whole book. Any
        // other error is operational and must still surface.
        if (error instanceof NotFoundError) return null
        throw error
      }
    },
  )

  book.chapters = chapters.filter(
    (chapter): chapter is Chapter => chapter != null,
  )

  // Keep the count consistent with what is actually returned; otherwise a book
  // with an absent chapter advertises more chapters than the array holds.
  book.chapterCount = book.chapters.length

  return book
}
