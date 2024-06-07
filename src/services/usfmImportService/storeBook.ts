import { createClient } from "redis"
import { storeChapter } from "./storeChapter"
import { getBookId } from "../book/getBookId"
import { getBookHeader } from "../book/getBookHeader"

export const storeBook = async (book: USFMBook): Promise<void> => {

    const bookId = getBookId(book)?.toLowerCase()

    if (bookId) {
        const client = createClient()
        await client.connect()

        await client.rPush('books', bookId)

        const bookName = getBookHeader(book, 'toc1')
        const bookAbrv = getBookHeader(book, 'toc3')

        if (bookName && bookAbrv) {
            Promise.all([
                await client.set(`book:${bookId}:toc1`, bookName),
                await client.set(`book:${bookId}:toc3`, bookAbrv)
            ])
        }

        Object.entries(book.chapters).forEach(async ([number, chapter]) => {
            await storeChapter(client, bookId, parseInt(number), chapter)
        })

    }
}