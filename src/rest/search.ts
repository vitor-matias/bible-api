import type { Request, Response } from "express"
import { searchVerses } from "../services/search/searchVerses"
import { semanticSearchVerses } from "../services/search/semanticSearch"
import { normalizeText } from "../util/normalizeText"

export const searchVersesController = async (req: Request, res: Response) => {
  const { client } = res.locals

  const { text, page = "1", limit = "10", semantic } = req.query

  // Parse parameters (validation already done in middleware)
  const pageNumber = Number.parseInt(page as string, 10)
  const limitNumber = Number.parseInt(limit as string, 10)

  if (semantic === "true") {
    try {
      const result = await semanticSearchVerses(
        client,
        text as string,
        pageNumber,
        limitNumber,
      )
      return res.json(result)
    } catch (error) {
      console.error("Semantic search error:", error)
      return res.status(500).json({ error: "Semantic search failed" })
    }
  } else {
    try {
      res.json(
        await searchVerses(
          client,
          normalizeText(text as string),
          pageNumber,
          limitNumber,
        ),
      )
    } catch (error) {
      console.error("Search error:", error)
      return res.status(500).json({ error: "Search failed" })
    }
  }
}
