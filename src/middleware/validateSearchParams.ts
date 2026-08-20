import type express from "express"

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

  if (trimmedText.length > 200) {
    return res
      .status(400)
      .json({ error: "Search text is too long (maximum 200 characters)" })
  }

  // In Express 5 req.query is a getter that re-parses on every access, so
  // mutating it here would be discarded. Hand the cleaned value to the
  // controller on res.locals instead.
  res.locals.searchText = trimmedText

  // Validate page parameter if provided
  if (page !== undefined) {
    const pageNumber = Number.parseInt(page as string, 10)
    if (Number.isNaN(pageNumber) || pageNumber < 1) {
      return res
        .status(400)
        .json({ error: "Page parameter must be a positive integer" })
    }

    // Bounds the RediSearch offset (page * limit); huge offsets error out
    // server-side and would surface as 500s instead of a clear 400
    if (pageNumber > 10000) {
      return res
        .status(400)
        .json({ error: "Page parameter cannot exceed 10000" })
    }
  }

  // Validate limit parameter if provided
  if (limit !== undefined) {
    const limitNumber = Number.parseInt(limit as string, 10)
    if (Number.isNaN(limitNumber) || limitNumber < 1) {
      return res
        .status(400)
        .json({ error: "Limit parameter must be a positive integer" })
    }

    if (limitNumber > 100) {
      return res
        .status(400)
        .json({ error: "Limit parameter cannot exceed 100" })
    }
  }

  next()
}
