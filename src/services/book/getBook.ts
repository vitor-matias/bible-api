import { createClient } from "redis"
import { getChapter } from "../chapter/getChapter"

export const getBook = async (client: ReturnType<typeof createClient>, bookId: Book['id'], getChapters = false): Promise<Book | null> => {

    const bookText = await client.get(`book:${bookId}`)

    if (!bookText) return null

    const book: Book = JSON.parse(bookText)

    book.chapters = []

    if (getChapters) {
        for (let i = 1; i <= book.chapterCount; i++) {
            book.chapters.push(await getChapter(client, bookId, i))
        }
    }
    return book
}