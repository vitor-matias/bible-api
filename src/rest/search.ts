import type { Request, Response } from "express"
import { searchVerses } from "../services/search/searchVerses"
import { semanticSearchVerses } from "../services/search/semanticSearchVerses"

export const searchVersesController = async (req: Request, res: Response) => {
  const { client } = res.locals

  const { text, page = "0", semantic } = req.query

  if (semantic === "true") {
    res.json(null) //TODO
  } else {
    res.json(await searchVerses(client, text as string, Number.parseInt(page as string, 10)))
  }
}
