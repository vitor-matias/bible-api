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

  if (text.length > 200) {
    return res
      .status(400)
      .json({ error: "Search text is too long (maximum 200 characters)" })
  }

  // Validate page parameter if provided
  if (page !== undefined) {
    const pageNumber = Number.parseInt(page as string, 10)
    if (Number.isNaN(pageNumber) || pageNumber < 1) {
      return res
        .status(400)
        .json({ error: "Page parameter must be a positive integer" })
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
