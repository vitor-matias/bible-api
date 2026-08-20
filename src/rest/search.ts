import type { Request, Response } from "express"
import { searchVerses } from "../services/search/searchVerses"
import {
  KNN_MAX_RESULTS,
  semanticSearchVerses,
} from "../services/search/semanticSearch"
import { isSemanticSearchAvailable } from "../util/importState"
import { normalizeText } from "../util/normalizeText"

export const searchVersesController = async (req: Request, res: Response) => {
  const { client } = res.locals

  const { text, page = "1", limit = "10", semantic } = req.query

  // validateSearchParams puts the trimmed text on res.locals; req.query still
  // holds the raw value because Express 5 rebuilds it on every access.
  const searchText =
    (res.locals.searchText as string | undefined) ?? (text as string)

  // Parse parameters (validation already done in middleware)
  const pageNumber = Number.parseInt(page as string, 10)
  const limitNumber = Number.parseInt(limit as string, 10)

  if (semantic === "true") {
    // Some chapters failed to embed, so the vector index covers only part of
    // the corpus. Answering anyway would look like a complete result set.
    if (!isSemanticSearchAvailable()) {
      return res.status(503).json({
        error:
          "Semantic search is unavailable: the embedding index is incomplete",
      })
    }

    // Past the KNN window the service can only answer with zeroed totals,
    // which reads as "no matches" rather than "beyond the search window".
    if ((pageNumber - 1) * limitNumber >= KNN_MAX_RESULTS) {
      return res.status(400).json({
        error: `Semantic search returns at most ${KNN_MAX_RESULTS} results; the requested page is beyond that window`,
      })
    }

    try {
      const result = await semanticSearchVerses(
        client,
        searchText,
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
          normalizeText(searchText),
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
