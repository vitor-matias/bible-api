import type { Request, Response } from "express"
import { searchVerses } from "../services/search/searchVerses"
import { semanticSearchVerses } from "../services/search/semanticSearch"
import { normalizeText } from "../util/normalizeText"

export const searchVersesController = async (req: Request, res: Response) => {
  const { client } = res.locals

  const { text, page = "1", limit = "10", semantic } = req.query

  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "Text parameter is required" })
  }

  // Validate text length
  if (text.length > 500) {
    return res
      .status(400)
      .json({ error: "Search text is too long (maximum 500 characters)" })
  }

  // Parse and validate page parameter
  const pageNumber = Number.parseInt(page as string, 10)
  if (Number.isNaN(pageNumber) || pageNumber < 1) {
    return res
      .status(400)
      .json({ error: "Page parameter must be a positive integer" })
  }

  // Parse and validate limit parameter
  const limitNumber = Number.parseInt(limit as string, 10)
  if (Number.isNaN(limitNumber) || limitNumber < 1) {
    return res
      .status(400)
      .json({ error: "Limit parameter must be a positive integer" })
  }

  // Enforce maximum limit to prevent abuse
  if (limitNumber > 100) {
    return res.status(400).json({ error: "Limit parameter cannot exceed 100" })
  }

  if (semantic === "true") {
    try {
      const result = await semanticSearchVerses(
        client,
        text,
        pageNumber,
        limitNumber,
      )
      return res.json(result)
    } catch (error) {
      console.error("Semantic search error:", error)
      return res.status(500).json({ error: "Semantic search failed" })
    }
  } else {
    res.json(
      await searchVerses(client, normalizeText(text), pageNumber, limitNumber),
    )
  }
}
