import type { Request, Response } from "express"
import { getChapter } from "../services/chapter/getChapter"

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
    console.error("Get chapter error:", error)
    return res.status(404).json({ error: "Chapter not found" })
  }

  res.status(404).json({ error: "Chapter not found" })
}
