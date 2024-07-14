import { Request, Response } from 'express'
import { getBook } from "../services/book/getBook";


export const getBookController = async (req: Request, res: Response) => {
    const { client } = res.locals

    const { book } = req.params

    const data = await getBook(client, book, true)

    if (data) {
        return res.json(data)
    }


    res.status(404).json({ error: 'Book not found' })
}