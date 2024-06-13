import { createClient } from "redis"

export const getBook = async (bookId: Book['id'], getChapters = false): Promise<Book> => {
    const client = createClient()
    await client.connect()

    const book = await client.get(`book:${bookId}`)

    return book ? JSON.parse(book) : null
}