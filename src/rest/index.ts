import type express from "express"
import { checkCache } from "../middleware/checkCache"
import { fullBookRateLimit, searchRateLimit } from "../middleware/rateLimiter"
import { validateBooksParams } from "../middleware/validateBooksParams"
import { validateQueryParams } from "../middleware/validateQueryParams"
import { validateSearchParams } from "../middleware/validateSearchParams"
import { getClient } from "../util/sharedClient"
import { getBookController } from "./book"
import { getBooksController } from "./books"
import { getChapterController } from "./chapter"
import { getIntroController, getIntrosController } from "./intros"
import { searchVersesController } from "./search"
import { getVerseController, getVersesController } from "./verses"

export default (app: express.Express): void => {
  // Every request uses the one shared connection (see sharedClient.ts).
  app.use(async (_req, res, next) => {
    try {
      res.locals.client = await getClient()
      next()
    } catch (error) {
      next(error)
    }
  })

  // The cached routes below key on the full originalUrl, so every route that
  // reaches checkCache validates its query parameters first — otherwise
  // arbitrary junk params mint unbounded cache entries.
  const noQueryParams = validateQueryParams([])

  // Endpoint to get a specific verse
  app.get(
    "/v1/:book/:chapter/:verse",
    noQueryParams,
    checkCache,
    getVerseController,
  )

  // Deliberately NOT cached: the cache keys on the full URL, and start/end are
  // free-form, so every (start, end) pair of every chapter would mint its own
  // entry — tens of millions of keys against the bound the validators exist to
  // keep. The range is served from one MGET instead.
  app.get(
    "/v1/:book/:chapter/:startVerse/:endVerse",
    noQueryParams,
    getVersesController,
  )

  // Validators run before the limiters: a request the validator will reject
  // must not consume the strict per-minute budget reserved for real work.
  app.get(
    "/v1/search",
    validateSearchParams,
    searchRateLimit,
    checkCache,
    searchVersesController,
  )
  app.get(
    "/v1/books",
    validateBooksParams,
    fullBookRateLimit,
    checkCache,
    getBooksController,
  )

  // Registered before the ":book" patterns of the same shape, which would
  // otherwise swallow these paths.
  app.get("/v1/intros", noQueryParams, checkCache, getIntrosController)
  app.get("/v1/intros/:slug", noQueryParams, checkCache, getIntroController)

  app.get("/v1/:book/:chapter", noQueryParams, checkCache, getChapterController)

  app.get(
    "/v1/:book",
    validateQueryParams(["withVerses"]),
    fullBookRateLimit,
    checkCache,
    getBookController,
  )

  // Final error handler: never leak stack traces to clients
  const errorHandler: express.ErrorRequestHandler = (err, _req, res, next) => {
    console.error("Unhandled request error:", err)
    if (res.headersSent) {
      // The response is already streaming; let Express abort the connection
      return next(err)
    }
    res.status(500).json({ error: "Internal server error" })
  }
  app.use(errorHandler)
}
