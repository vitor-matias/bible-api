import type express from "express"
import { createClient } from "redis"
import { checkCache } from "../middleware/checkCache"
import { getBookController } from "./book"
import { getBooksController } from "./books"
import { getChapterController } from "./chapter"
import { searchVersesController } from "./search"
import { getVerseController, getVersesController } from "./verses"

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
  app.get("/v1/search", checkCache, searchVersesController)

  app.get("/v1/:book/:chapter", getChapterController)

  app.get("/v1/:book", checkCache, getBookController)
}
