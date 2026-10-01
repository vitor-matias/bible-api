import type { Request, Response } from "express"
import { getBook } from "../services/book/getBook"
import { mapWithConcurrency } from "../util/concurrency"

// Books are read a few at a time; each one already fans out over its chapters,
// so an unbounded Promise.all here multiplies the two.
const BOOK_CONCURRENCY = 4

export const getBooksController = async (req: Request, res: Response) => {
  const { client } = res.locals
  const { withChapters } = req.query as { withChapters?: string }

  const bookIds: string[] = await client.lRange("books", 0, -1)

  const bookList = await mapWithConcurrency(
    bookIds,
    BOOK_CONCURRENCY,
    (bookId) => getBook(client, bookId, withChapters === "true"),
  )

  res.json(bookList)
}
