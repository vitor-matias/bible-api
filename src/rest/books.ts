import { createClient } from "redis";
import { Request, Response } from 'express'


export const getBooksController = async (req: Request, res: Response) => {
    const client = createClient();
    await client.connect();

    res.json(await client.lRange('books', 0, -1))
}