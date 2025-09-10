import type { Request, Response } from "express"
import { getVerse } from "../services/verse/getVerse"

export const getVerseController = async (req: Request, res: Response) => {
  const { book, chapter, verse } = req.params

  const { client } = res.locals

  const verseData = await getVerse(
    client,
    book,
    Number.parseInt(chapter, 10),
    Number.parseInt(verse, 10),
  )
  if (verseData) {
    return res.json(verseData)
  }

  res.status(404).json({ error: "Verse not found" })
}

export const getVersesController = async (req: Request, res: Response) => {
  const { book, chapter, startVerse, endVerse } = req.params
  const { client } = res.locals

  if (Number.parseInt(startVerse, 10) > Number.parseInt(endVerse, 10)) {
    let currentVerse = Number.parseInt(startVerse, 10)

    const verseData = []

    while (currentVerse <= Number.parseInt(endVerse, 10)) {
      const data = await getVerse(
        client,
        book,
        Number.parseInt(chapter, 10),
        currentVerse,
      )

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
