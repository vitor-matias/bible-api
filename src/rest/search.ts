import type { Request, Response } from "express"
import { searchVerses } from "../services/search/searchVerses"
import { semanticSearchVerses } from "../services/search/semanticSearch"

export const searchVersesController = async (req: Request, res: Response) => {
  const { client } = res.locals
  const { text, sanitizedText, page, limit } = res.locals.searchParams

  const { semantic } = req.query

  if (semantic === "true") {
    try {
      const result = await semanticSearchVerses(client, text, page, limit)
      return res.json(result)
    } catch (error) {
      console.error("Semantic search error:", error)
      return res.status(500).json({
        error: "Semantic search failed",
        details: "An internal error occurred",
      })
    }
  }

  res.json(await searchVerses(client, sanitizedText, page, limit))
}
