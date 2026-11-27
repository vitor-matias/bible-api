import { createHash } from "node:crypto"
import type { Request, Response } from "express"
import type { createClient } from "redis"
import { getBook } from "../services/book/getBook"
import { mapWithConcurrency } from "../util/concurrency"

// Books are read a few at a time; each one already fans out over its chapters,
// so an unbounded Promise.all here multiplies the two.
const BOOK_CONCURRENCY = 4

const listBooks = async (
  client: ReturnType<typeof createClient>,
  withChapters: boolean,
) => {
  const bookIds: string[] = await client.lRange("books", 0, -1)
  return mapWithConcurrency(bookIds, BOOK_CONCURRENCY, (bookId) =>
    getBook(client, bookId, withChapters),
  )
}

export const getBooksController = async (req: Request, res: Response) => {
  const { withChapters } = req.query as { withChapters?: string }
  res.json(await listBooks(res.locals.client, withChapters === "true"))
}

/**
 * The hash of the full catalog (/v1/books?withChapters=true), which the apps
 * keep offline: one that hashes differently from their copy downloads it
 * again. Data changes only by an import at startup, before data is served, so
 * each process hashes once.
 */
export const makeCatalogHashController = () => {
  let hash: Promise<string> | undefined
  return async (_req: Request, res: Response) => {
    hash ??= listBooks(res.locals.client, true).then((books) =>
      createHash("sha256").update(JSON.stringify(books)).digest("hex"),
    )
    try {
      res.json({ hash: await hash })
    } catch (error) {
      // A failed read is not kept: the next request tries again.
      hash = undefined
      throw error
    }
  }
}
