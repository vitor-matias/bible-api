import { createClient } from "redis"
import { getBookHeader } from "../book/getBookHeader"
import { getBookId } from "../book/getBookId"
import { storeChapter } from "./storeChapter"

export const storeBook = async (usfmBook: USFMBook): Promise<void> => {
  const bookId = getBookId(usfmBook)?.toLowerCase()

  if (bookId) {
    const client = createClient({
      url: process.env.DB_URL,
      socket: {
        connectTimeout: 100000,
      },
    })
    await client.connect()

    await client.rPush("books", bookId)

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
      await storeChapter(client, bookId, Number.parseInt(number), chapter)
    }
    await client.quit()
  }
}
