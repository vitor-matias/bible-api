import { createClient } from "redis";
import { Request, Response } from 'express'
import { getBook } from "../services/book/getBook";


export const getBooksController = async (req: Request, res: Response) => {
    const client = createClient();
    await client.connect();

    const bookList = (await client.lRange('books', 0, -1)).map(async (bookId) =>{
       await getBook(bookId)
    })

    await client.quit()

    res.json(bookList)
}