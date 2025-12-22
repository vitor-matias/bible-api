import type express from "express"
import { createClient } from "redis"
import { checkCache } from "../middleware/checkCache"
import { searchRateLimiter } from "../middleware/rateLimiter"
import { getBookController } from "./book"
import { getBooksController } from "./books"
import { getChapterController } from "./chapter"
import { searchVersesController } from "./search"
import { getVerseController, getVersesController } from "./verses"

// Middleware to validate search query parameters
const validateSearchParams = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const { text, page, limit } = req.query

  // Validate text parameter
  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "Text parameter is required" })
  }

  if (text.length > 200) {
    return res
      .status(400)
      .json({ error: "Search text is too long (maximum 500 characters)" })
  }

  // Validate page parameter if provided
  if (page !== undefined) {
    const pageNumber = Number.parseInt(page as string, 10)
    if (Number.isNaN(pageNumber) || pageNumber < 1) {
      return res
        .status(400)
        .json({ error: "Page parameter must be a positive integer" })
    }
  }

  // Validate limit parameter if provided
  if (limit !== undefined) {
    const limitNumber = Number.parseInt(limit as string, 10)
    if (Number.isNaN(limitNumber) || limitNumber < 1) {
      return res
        .status(400)
        .json({ error: "Limit parameter must be a positive integer" })
    }

    if (limitNumber > 100) {
      return res
        .status(400)
        .json({ error: "Limit parameter cannot exceed 100" })
    }
  }

  next()
}

export default (app: express.Express): void => {
  let client: ReturnType<typeof createClient>

  app.use(async (_req, res, next) => {
    if (!client || !client.isReady) {
      client = createClient({ url: process.env.DB_URL })
      await client.connect()
    }
    res.locals.client = client
    next()
  })

  // Endpoint to get a specific verse
  app.get("/v1/:book/:chapter/:verse", checkCache, getVerseController)

  // Endpoint to get a specific verse
  app.get("/v1/:book/:chapter/:startVerse/:endVerse", getVersesController)

  app.get("/v1/books", getBooksController)
  app.get(
    "/v1/search",
    searchRateLimiter,
    validateSearchParams,
    checkCache,
    searchVersesController,
  )

  app.get("/v1/:book/:chapter", getChapterController)

  app.get("/v1/:book", checkCache, getBookController)
}
