import type { Request, Response } from "express"
import { searchVerses } from "../services/search/searchVerses"

export const searchVersesController = async (req: Request, res: Response) => {
  const { client } = res.locals
  const { text, page, limit } = res.locals.searchParams

  const { semantic } = req.query

  if (semantic === "true") {
    return res.status(501).json({ error: "Semantic search is not implemented" })
  }

  res.json(await searchVerses(client, text, page, limit))
}
