import type express from "express"
import { createClient } from "redis"
import { checkCache } from "../middleware/checkCache"
import { fullBookRateLimit, searchRateLimit } from "../middleware/rateLimiter"
import { validateBooksParams } from "../middleware/validateBooksParams"
import { validateQueryParams } from "../middleware/validateQueryParams"
import { validateSearchParams } from "../middleware/validateSearchParams"
import { getBookController } from "./book"
import { getBooksController } from "./books"
import { getChapterController } from "./chapter"
import { getIntroController, getIntrosController } from "./intros"
import { searchVersesController } from "./search"
import { getVerseController, getVersesController } from "./verses"

export default (app: express.Express): void => {
  // A single shared client is reused across requests. The "error" listener is
  // required: without it, node-redis throws on connection loss and crashes the
  // process. node-redis reconnects automatically; commands fail fast meanwhile.
  let client: ReturnType<typeof createClient> | undefined
  // Concurrent requests arriving before the socket is open share one
  // handshake; calling connect() twice on the same client throws.
  let connecting: Promise<unknown> | undefined

  const getClient = async () => {
    if (!client) {
      // Without a bound, node-redis queues every command issued during an
      // outage, so a long one lets requests pile up until the process runs out
      // of memory. Failing fast turns them into 500s instead; reconnection
      // still happens in the background.
      client = createClient({
        url: process.env.DB_URL,
        disableOfflineQueue: true,
      })
      client.on("error", (err) => console.error(`Redis client error: ${err}`))
    }
    if (!client.isOpen) {
      connecting ??= client.connect().finally(() => {
        connecting = undefined
      })
      await connecting
    }
    return client
  }

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
  // text/page/limit are validated in detail by validateSearchParams; this only
  // bounds the key space (no unknown params, semantic limited to true/false).
  const validateSearchQueryParams = validateQueryParams(
    ["text", "page", "limit", "semantic"],
    ["semantic"],
  )

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
  // keep. The range is served from one JSON.MGET instead.
  app.get(
    "/v1/:book/:chapter/:startVerse/:endVerse",
    noQueryParams,
    getVersesController,
  )

  // Validators run before the limiters: a request the validator will reject
  // must not consume the strict per-minute budget reserved for real work. The
  // limiter sits after checkCache for the same reason: a cached replay makes
  // no OpenAI call and runs no query, so it must not spend that budget either.
  app.get(
    "/v1/search",
    validateSearchQueryParams,
    validateSearchParams,
    checkCache,
    searchRateLimit,
    searchVersesController,
  )
  // The full-book limiter sits after checkCache: it guards the expensive
  // materialization on a miss, and a cached replay must not spend that budget.
  app.get(
    "/v1/books",
    validateBooksParams,
    checkCache,
    fullBookRateLimit,
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
    checkCache,
    fullBookRateLimit,
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
