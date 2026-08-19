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

// Strict limiter for the full-book materializations, which fetch every verse of
// every requested chapter on a cache miss.
export const fullBookRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: {
    error: "Too many requests, please try again later.",
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
})

// Rate-limits the variants that fan out to getBook(..., true) — withChapters on
// the books listing and withVerses on a single book. Both read every verse of
// every chapter they touch; the plain listings are cheap and cached.
export const fullBookRateLimit = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (req.query.withChapters === "true" || req.query.withVerses === "true") {
    return fullBookRateLimiter(req, res, next)
  }
  return next()
}
