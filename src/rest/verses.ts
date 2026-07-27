import type { Request, Response } from "express"
import { getVerse } from "../services/verse/getVerse"

const MAX_VERSE_RANGE = 200

const parseVerseNumber = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

export const getVerseController = async (req: Request, res: Response) => {
  const { book, chapter, verse } = req.params

  const { client } = res.locals

  const chapterNumber = parseVerseNumber(chapter)
  const verseNumber = parseVerseNumber(verse)

  if (chapterNumber === null || verseNumber === null) {
    return res.status(400).json({ error: "Chapter and verse must be numbers" })
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

  const chapterNumber = parseVerseNumber(chapter)
  const start = parseVerseNumber(startVerse)
  const end = parseVerseNumber(endVerse)

  if (chapterNumber === null || start === null || end === null) {
    return res.status(400).json({ error: "Chapter and verses must be numbers" })
  }

  if (start > end) {
    return res
      .status(400)
      .json({ error: "Start verse must not be greater than end verse" })
  }

  if (end - start + 1 > MAX_VERSE_RANGE) {
    return res
      .status(400)
      .json({ error: `Verse range must be at most ${MAX_VERSE_RANGE} verses` })
  }

  const results = await Promise.all(
    Array.from({ length: end - start + 1 }, (_, i) =>
      getVerse(client, book, chapterNumber, start + i),
    ),
  )

  // Keep only the leading run of existing verses, as before
  const verseData: Verse[] = []
  for (const verse of results) {
    if (!verse) {
      break
    }
    verseData.push(verse)
  }

  if (verseData.length > 0) {
    return res.json(verseData)
  }

  res.status(404).json({ error: "Verse not found" })
}
