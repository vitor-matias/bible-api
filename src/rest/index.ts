import type express from "express"
import type { createClient } from "redis"
import { cacheResponse } from "../middleware/cacheResponse"
import {
  generalRateLimiter,
  searchRateLimiter,
  semanticSearchRateLimiter,
} from "../middleware/rateLimiter"
import { validateSearchParams } from "../middleware/validateSearchParams"
import { getBookController } from "./book"
import { getBooksController } from "./books"
import { getChapterController } from "./chapter"
import { searchVersesController } from "./search"
import { getVerseController, getVersesController } from "./verses"

const setEndpoints = (
  app: express.Express,
  client: ReturnType<typeof createClient>,
): void => {
  app.use((_req, res, next) => {
    res.locals.client = client
    next()
  })

  app.use(generalRateLimiter)

  app.get("/v1/books", cacheResponse(["withChapters"]), getBooksController)

  app.get(
    "/v1/search",
    searchRateLimiter,
    semanticSearchRateLimiter,
    validateSearchParams,
    cacheResponse(["text", "page", "limit", "semantic"]),
    searchVersesController,
  )

  // Endpoint to get a specific verse
  app.get("/v1/:book/:chapter/:verse", cacheResponse(), getVerseController)

  // Endpoint to get a range of verses
  app.get(
    "/v1/:book/:chapter/:startVerse/:endVerse",
    cacheResponse(),
    getVersesController,
  )

  app.get("/v1/:book/:chapter", cacheResponse(), getChapterController)

  app.get("/v1/:book", cacheResponse(["withVerses"]), getBookController)

  // Final error handler: never leak stack traces to clients
  const errorHandler: express.ErrorRequestHandler = (err, _req, res, _next) => {
    console.error("Unhandled request error:", err)
    res.status(500).json({ error: "Internal server error" })
  }
  app.use(errorHandler)
}

export default setEndpoints
