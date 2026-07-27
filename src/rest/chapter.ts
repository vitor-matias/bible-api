import type { Request, Response } from "express"
import { getChapter } from "../services/chapter/getChapter"
import { parseRouteNumber } from "../util/parseRouteNumber"

export const getChapterController = async (req: Request, res: Response) => {
  const { book, chapter } = req.params
  const { client } = res.locals

  const chapterNumber = parseRouteNumber(chapter)
  if (chapterNumber === null || chapterNumber < 1) {
    return res.status(400).json({ error: "Chapter must be a positive number" })
  }

  const chapterData = await getChapter(client, book, chapterNumber)
  if (chapterData) {
    return res.json(chapterData)
  }

  res.status(404).json({ error: "Chapter not found" })
}
