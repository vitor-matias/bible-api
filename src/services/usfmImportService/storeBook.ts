import type { createClient } from "redis"
import type { TaskPool } from "../../util/concurrency"
import { getBookHeader } from "../book/getBookHeader"
import { getBookId } from "../book/getBookId"
import { extractBookIntro } from "./bookIntroUtils"
import { storeChapter } from "./storeChapter"
import {
  introSlugFromFileName,
  isPeripheralBookId,
  storeIntro,
} from "./storeIntro"

// The caller owns the connection: opening one client per source file cost 90
// connections and handshakes per import, several of them for two commands. It
// also owns `embeddings`, which runs each chapter's embedding call in the
// background and must be drained before the import counts as finished.
export const storeBook = async (
  client: ReturnType<typeof createClient>,
  usfmBook: USFMBook,
  sourceFile: string,
  embeddings: TaskPool,
): Promise<void> => {
  const bookId = getBookId(usfmBook)?.toLowerCase()

  if (!bookId) return

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

  for (const [label, chapter] of Object.entries(usfmBook.chapters)) {
    const number = Number.parseInt(label, 10)
    // Sequential on purpose: a chapter's heading can carry over to the next
    // chapter's title, so chapters are stored in order. Their embedding calls
    // already run concurrently in the pool.
    await storeChapter(client, bookId, bookCount, number, chapter, embeddings) // NOSONAR
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
