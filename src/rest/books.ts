import { Request, Response } from 'express'
import { getBook } from "../services/book/getBook";


export const getBooksController = async (req: Request, res: Response) => {
    const { client } = res.locals

    const bookList = await Promise.all((await client.lRange('books', 0, -1)).map(async (bookId: string) =>
        await getBook(client, bookId)
    ))

    res.json(bookList)
}