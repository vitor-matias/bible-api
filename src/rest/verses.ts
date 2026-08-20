import type { Request, Response } from "express"
import { getVerse } from "../services/verse/getVerse"
import { parseNumericParam } from "../util/parseParams"

const MAX_VERSE_RANGE = 200

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
    // No chapter has more verses than this; larger ranges are client error
    if (lastVerse - firstVerse + 1 > MAX_VERSE_RANGE) {
      return res.status(400).json({
        error: `Verse range must be at most ${MAX_VERSE_RANGE} verses`,
      })
    }

    // One pipelined round trip instead of a serial fetch per verse
    const results = await Promise.all(
      Array.from({ length: lastVerse - firstVerse + 1 }, (_, i) =>
        getVerse(client, book, chapterNumber, firstVerse + i),
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
  }

  res.status(404).json({ error: "Verse not found" })
}
