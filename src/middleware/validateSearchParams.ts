import type express from "express"

// Must match the defaults searchVersesController applies when the parameters
// are absent, so the offset bound below reflects the query actually issued.
const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 10
const MAX_LIMIT = 100
const MAX_TEXT_LENGTH = 200

// RediSearch rejects any query whose LIMIT offset + num exceeds
// MAXSEARCHRESULTS (10000 by default), and that error surfaces as a 500.
const MAX_SEARCH_RESULTS = 10000

// Middleware to validate search query parameters
export const validateSearchParams = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const { text, page, limit } = req.query

  // Validate text parameter
  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "Text parameter is required" })
  }

  const trimmedText = text.trim()

  if (!trimmedText) {
    return res.status(400).json({ error: "Text parameter cannot be blank" })
  }

  if (trimmedText.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({
      error: `Search text is too long (maximum ${MAX_TEXT_LENGTH} characters)`,
    })
  }

  // In Express 5 req.query is a getter that re-parses on every access, so
  // mutating it here would be discarded. Hand the cleaned value to the
  // controller on res.locals instead.
  res.locals.searchText = trimmedText

  // Limit is validated before page because the offset bound needs both.
  let limitNumber = DEFAULT_LIMIT
  if (limit !== undefined) {
    limitNumber = Number.parseInt(limit as string, 10)

    if (Number.isNaN(limitNumber) || limitNumber < 1) {
      return res
        .status(400)
        .json({ error: "Limit parameter must be a positive integer" })
    }

    if (limitNumber > MAX_LIMIT) {
      return res
        .status(400)
        .json({ error: `Limit parameter cannot exceed ${MAX_LIMIT}` })
    }
  }

  let pageNumber = DEFAULT_PAGE
  if (page !== undefined) {
    pageNumber = Number.parseInt(page as string, 10)

    if (Number.isNaN(pageNumber) || pageNumber < 1) {
      return res
        .status(400)
        .json({ error: "Page parameter must be a positive integer" })
    }
  }

  // offset + num is (page - 1) * limit + limit, i.e. page * limit. Bounding
  // the page alone let e.g. page=101&limit=100 through and RediSearch 500'd.
  if (pageNumber * limitNumber > MAX_SEARCH_RESULTS) {
    return res.status(400).json({
      error: `page x limit cannot exceed ${MAX_SEARCH_RESULTS} results`,
    })
  }

  next()
}
