import type { Request, Response } from "express"
import { getVerse } from "../services/verse/getVerse"
import { parseNumericParam } from "../util/parseParams"

export const getVerseController = async (req: Request, res: Response) => {
  const { book, chapter, verse } = req.params

  const { client } = res.locals

  const chapterNumber = parseNumericParam(chapter)
  const verseNumber = parseNumericParam(verse)

  if (Number.isNaN(chapterNumber) || Number.isNaN(verseNumber)) {
    return res.status(404).json({ error: "Verse not found" })
  }

  const verseData = await getVerse(client, book, chapterNumber, verseNumber)
  if (verseData) {
    return res.json(verseData)
  }

  res.status(404).json({ error: "Verse not found" })
}

export const getVersesController = async (req: Request, res: Response) => {
  const { book, chapter, startVerse, endVerse } = req.params
  const { client } = res.locals

  const chapterNumber = parseNumericParam(chapter)
  const firstVerse = parseNumericParam(startVerse)
  const lastVerse = parseNumericParam(endVerse)

  // NaN fails every comparison, so malformed parameters fall through to 404.
  if (!Number.isNaN(chapterNumber) && firstVerse <= lastVerse) {
    let currentVerse = firstVerse

    const verseData = []

    while (currentVerse <= lastVerse) {
      const data = await getVerse(client, book, chapterNumber, currentVerse)

      if (!data) {
        break
      }

      verseData.push(data)

      currentVerse++
    }

    if (verseData) {
      return res.json(verseData)
    }
  }

  res.status(404).json({ error: "Verse not found" })
}
