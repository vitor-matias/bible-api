import type { Request, Response } from "express"
import { getChapter } from "../services/chapter/getChapter"
import { NotFoundError } from "../util/errors"

export const getChapterController = async (req: Request, res: Response) => {
  const { book, chapter } = req.params
  const { client } = res.locals
  try {
    const chapterData = await getChapter(
      client,
      book,
      Number.parseInt(chapter, 10),
    )
    if (chapterData) {
      return res.json(chapterData)
    }
  } catch (error) {
    // getChapter signals a missing chapter with NotFoundError; anything else
    // (e.g. Redis connectivity) is an operational failure, not a 404.
    if (error instanceof NotFoundError) {
      return res.status(404).json({ error: "Chapter not found" })
    }
    console.error("Get chapter error:", error)
    return res.status(500).json({ error: "Internal server error" })
  }

  res.status(404).json({ error: "Chapter not found" })
}
