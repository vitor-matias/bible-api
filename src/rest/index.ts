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
import { searchVersesController } from "./search"
import { getVerseController, getVersesController } from "./verses"

export default (app: express.Express): void => {
  // A single shared client is reused across requests. The "error" listener is
  // required: without it, node-redis throws on connection loss and crashes the
  // process. node-redis reconnects automatically and queues commands meanwhile.
  let client: ReturnType<typeof createClient> | undefined
  // Concurrent requests arriving before the socket is open share one
  // handshake; calling connect() twice on the same client throws.
  let connecting: Promise<unknown> | undefined

  const getClient = async () => {
    if (!client) {
      client = createClient({ url: process.env.DB_URL })
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

  // Endpoint to get a specific verse
  app.get(
    "/v1/:book/:chapter/:verse",
    noQueryParams,
    checkCache,
    getVerseController,
  )

  // Endpoint to get a specific verse
  app.get(
    "/v1/:book/:chapter/:startVerse/:endVerse",
    noQueryParams,
    getVersesController,
  )

  app.get(
    "/v1/search",
    searchRateLimit,
    validateSearchParams,
    checkCache,
    searchVersesController,
  )
  app.get(
    "/v1/books",
    fullBookRateLimit,
    validateBooksParams,
    checkCache,
    getBooksController,
  )

  app.get("/v1/:book/:chapter", noQueryParams, checkCache, getChapterController)

  app.get(
    "/v1/:book",
    fullBookRateLimit,
    validateQueryParams(["withVerses"]),
    checkCache,
    getBookController,
  )
}
