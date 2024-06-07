import { createClient } from "redis"
import { storeChapter } from "./storeChapter"
import { getBookId } from "../book/getBookId"
import { getBookName } from "../book/getBookName"

export const storeBook = async (book: USFMBook): Promise<void> => {

    const bookId = getBookId(book)?.toLowerCase()

    if (bookId) {
        const client = createClient()
        await client.connect()

        await client.rPush('books', bookId)

        const bookName = getBookName(book)

        if(bookName){
            await client.set(`book:${bookId}:toc1`, bookName)
        }

        Object.entries(book.chapters).forEach(async ([number, chapter]) => {
            await storeChapter(client, bookId, parseInt(number), chapter)
        })
        
    }
}