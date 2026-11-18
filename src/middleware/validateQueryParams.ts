import type express from "express"

// Builds a middleware that rejects unrecognized query parameters and bounds the
// values of the boolean-valued ones. Since checkCache keys on the full
// originalUrl, this bounds the cache key space to the recognized variants and
// stops junk-param cache busting from evicting legitimate entries.
export const validateQueryParams = (
  allowedParams: readonly string[],
  booleanParams: readonly string[] = allowedParams,
) => {
  const allowed = new Set(allowedParams)

  return (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    const unknown = Object.keys(req.query).filter(
      (param) => !allowed.has(param),
    )

    if (unknown.length > 0) {
      return res
        .status(400)
        .json({ error: `Unknown query parameters: ${unknown.join(", ")}` })
    }

    for (const param of booleanParams) {
      const value = req.query[param]
      if (value !== undefined && value !== "true" && value !== "false") {
        return res
          .status(400)
          .json({ error: `${param} must be "true" or "false"` })
      }
    }

    next()
  }
}
