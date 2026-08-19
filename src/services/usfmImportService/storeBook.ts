import { createClient } from "redis"
import { getBookHeader } from "../book/getBookHeader"
import { getBookId } from "../book/getBookId"
import { extractBookIntro } from "./bookIntroUtils"
import { storeChapter } from "./storeChapter"
import {
  introSlugFromFileName,
  isPeripheralBookId,
  storeIntro,
} from "./storeIntro"

export const storeBook = async (
  usfmBook: USFMBook,
  sourceFile: string,
): Promise<void> => {
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
      if (isPeripheralBookId(bookId)) {
        await storePeripheralIntro(client, usfmBook, sourceFile)
        return
      }

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

// Front matter carries an introduction and no chapters. It is stored by slug so
// the files do not collide on their shared id, and it never reaches the verse
// or embedding indexes.
const storePeripheralIntro = async (
  client: ReturnType<typeof createClient>,
  usfmBook: USFMBook,
  sourceFile: string,
): Promise<void> => {
  const introduction = extractBookIntro(usfmBook.headers)

  if (!introduction) {
    console.warn(`No introduction content found in ${sourceFile}; skipping.`)
    return
  }

  const name =
    getBookHeader(usfmBook, "toc1") ?? getBookHeader(usfmBook, "h") ?? ""

  await storeIntro(
    client,
    introSlugFromFileName(sourceFile),
    name,
    introduction,
  )
}
