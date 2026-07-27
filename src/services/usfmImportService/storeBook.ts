import type { createClient } from "redis"
import { getBookHeader } from "../book/getBookHeader"
import { getBookId } from "../book/getBookId"
import { storeChapter } from "./storeChapter"

export const storeBook = async (
  client: ReturnType<typeof createClient>,
  usfmBook: USFMBook,
): Promise<void> => {
  const bookId = getBookId(usfmBook)?.toLowerCase()

  if (bookId) {
    const bookCount = await client.rPush("books", bookId)

    const bookName = getBookHeader(usfmBook, "toc1")
    const bookShortName = getBookHeader(usfmBook, "toc2")
    const bookAbrv = getBookHeader(usfmBook, "toc3")

    const book: Book = {
      id: bookId,
      name: bookName ?? "",
      shortName: bookShortName ?? "",
      abrv: bookAbrv ?? "",
      chapterCount: Object.keys(usfmBook.chapters).length,
    }

    await client.json.set(`book:${bookId}`, "$", book)

    for (const [number, chapter] of Object.entries(usfmBook.chapters)) {
      await storeChapter(
        client,
        bookId,
        bookCount,
        Number.parseInt(number, 10),
        chapter,
      )
    }
  }
}
