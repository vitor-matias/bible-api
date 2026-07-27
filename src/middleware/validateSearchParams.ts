import type { NextFunction, Request, Response } from "express"
import { sanitizeSearchQuery } from "../util/sanitizeSearchQuery"

const MAX_TEXT_LENGTH = 100
const MAX_PAGE = 10000
const MAX_LIMIT = 50

const isPositiveInteger = (value: unknown): value is string =>
  typeof value === "string" && /^\d+$/.test(value)

/**
 * Validates and sanitizes search query parameters, storing the parsed
 * values in res.locals.searchParams for the controller.
 */
export const validateSearchParams = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const { text, page = "1", limit = "10" } = req.query

  if (typeof text !== "string" || text.trim() === "") {
    return res.status(400).json({ error: 'Query parameter "text" is required' })
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({
      error: `Query parameter "text" must be at most ${MAX_TEXT_LENGTH} characters`,
    })
  }

  const sanitizedText = sanitizeSearchQuery(text)
  if (sanitizedText === "") {
    return res.status(400).json({
      error: 'Query parameter "text" contains no searchable characters',
    })
  }

  if (!isPositiveInteger(page) || Number.parseInt(page, 10) < 1) {
    return res
      .status(400)
      .json({ error: 'Query parameter "page" must be a positive integer' })
  }

  if (!isPositiveInteger(limit) || Number.parseInt(limit, 10) < 1) {
    return res
      .status(400)
      .json({ error: 'Query parameter "limit" must be a positive integer' })
  }

  const pageNumber = Number.parseInt(page, 10)
  const limitNumber = Number.parseInt(limit, 10)

  if (pageNumber > MAX_PAGE) {
    return res
      .status(400)
      .json({ error: `Query parameter "page" must be at most ${MAX_PAGE}` })
  }

  if (limitNumber > MAX_LIMIT) {
    return res
      .status(400)
      .json({ error: `Query parameter "limit" must be at most ${MAX_LIMIT}` })
  }

  res.locals.searchParams = {
    text: sanitizedText,
    page: pageNumber,
    limit: limitNumber,
  }

  next()
}
