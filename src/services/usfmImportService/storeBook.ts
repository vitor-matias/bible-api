import { createClient } from "redis"
import { getBookHeader } from "../book/getBookHeader"
import { getBookId } from "../book/getBookId"
import { extractBookIntro } from "./bookIntroUtils"
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
    client.on("error", (err) => console.error(`Redis client error: ${err}`))
    await client.connect()

    try {
      const bookCount = await client.rPush("books", bookId)

      const bookName = getBookHeader(usfmBook, "toc1")
      const bookShortName = getBookHeader(usfmBook, "toc2")
      const bookAbrv = getBookHeader(usfmBook, "toc3")

      const introduction = extractBookIntro(usfmBook.headers)

      const book: Book = {
        id: bookId,
        name: bookName ?? "",
        shortName: bookShortName ?? "",
        abrv: bookAbrv ?? "",
        chapterCount: Object.keys(usfmBook.chapters).length,
        ...(introduction && { introduction }),
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
    } finally {
      // storeChapter can throw (e.g. repeated embedding failures aborting the
      // import), so the connection must be closed on every path.
      await client.quit()
    }
  }
}
