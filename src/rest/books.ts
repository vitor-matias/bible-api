import type { Request, Response } from "express"
import { getBook } from "../services/book/getBook"

export const getBooksController = async (_req: Request, res: Response) => {
  const { client } = res.locals
  const { withChapters } = _req.query as { withChapters?: string }

  const bookList = await Promise.all(
    (await client.lRange("books", 0, -1)).map(
      async (bookId: string) =>
        await getBook(client, bookId, withChapters === "true"),
    ),
  )

  res.json(bookList)
}
