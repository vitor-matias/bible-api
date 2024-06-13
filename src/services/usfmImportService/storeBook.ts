import { createClient } from "redis"
import { storeChapter } from "./storeChapter"
import { getBookId } from "../book/getBookId"
import { getBookHeader } from "../book/getBookHeader"

export const storeBook = async (usfmBook: USFMBook): Promise<void> => {

    const bookId = getBookId(usfmBook)?.toLowerCase()

    if (bookId) {
        const client = createClient()
        await client.connect()

        await client.rPush('books', bookId)

        const bookName = getBookHeader(usfmBook, 'toc1')
        const bookAbrv = getBookHeader(usfmBook, 'toc3')

        const book: Book = {
            id: bookId,
            name: bookName ?? '',
            shortName: bookAbrv ?? '',
            chapterCount: Object.keys(usfmBook.chapters).length,
        }

        await client.set(`book:${bookId}`, JSON.stringify(book))


        Object.entries(usfmBook.chapters).forEach(async ([number, chapter]) => {
            await storeChapter(client, bookId, parseInt(number), chapter)
        })

    }
}