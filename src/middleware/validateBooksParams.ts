import type express from "express"

const ALLOWED_PARAMS = new Set(["withChapters"])

// Rejects unrecognized query parameters on /v1/books. Since checkCache keys on
// the full originalUrl, this bounds the cache key space to the recognized
// variants and stops junk-param cache busting.
export const validateBooksParams = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const unknown = Object.keys(req.query).filter(
    (param) => !ALLOWED_PARAMS.has(param),
  )

  if (unknown.length > 0) {
    return res
      .status(400)
      .json({ error: `Unknown query parameters: ${unknown.join(", ")}` })
  }

  next()
}
