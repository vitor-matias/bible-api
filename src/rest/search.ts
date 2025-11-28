import type { Request, Response } from "express"
import { searchVerses } from "../services/search/searchVerses"
import { normalizeText } from "../util/normalizeText"

export const searchVersesController = async (req: Request, res: Response) => {
  const { client } = res.locals

  const { text, page = "1", limit = "10", semantic } = req.query

  if (semantic === "true") {
    res.json(null) //TODO
  } else {
    res.json(
      await searchVerses(
        client,
        normalizeText(text as string),
        Number.parseInt(page as string, 10),
        Number.parseInt(limit as string, 10),
      ),
    )
  }
}
