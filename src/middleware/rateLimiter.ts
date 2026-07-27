import type { NextFunction, Request, Response } from "express"
import rateLimit from "express-rate-limit"

// Rate limiter for regular search endpoints
export const searchRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  message: {
    error: "Too many search requests, please try again later.",
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
})

// Stricter limiter for semantic search (uses OpenAI API)
export const semanticSearchRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: {
    error: "Too many semantic search requests, please try again later.",
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
})

// Applies the stricter limiter to semantic searches (which call the OpenAI API)
// and the regular limiter to everything else on the search endpoint.
export const searchRateLimit = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (req.query.semantic === "true") {
    return semanticSearchRateLimiter(req, res, next)
  }
  return searchRateLimiter(req, res, next)
}

// Strict limiter for the full-Bible materialization on /v1/books?withChapters=true,
// which fetches every verse of every book on a cache miss.
export const booksWithChaptersRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: {
    error: "Too many requests, please try again later.",
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
})

// Rate-limits only the expensive withChapters variant of the books listing;
// the plain listing is cheap and cached.
export const booksRateLimit = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (req.query.withChapters === "true") {
    return booksWithChaptersRateLimiter(req, res, next)
  }
  return next()
}
