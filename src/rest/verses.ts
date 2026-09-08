import type { Request, Response } from "express"
import { getVerse, verseKey } from "../services/verse/getVerse"
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

    // A single JSON.MGET for the whole span, so a range of absent verses costs
    // one command rather than one per verse.
    const keys = Array.from({ length: lastVerse - firstVerse + 1 }, (_, i) =>
      verseKey(book, chapterNumber, firstVerse + i),
    )
    const results = await client.json.mGet(keys, "$")

    // Keep only the leading run of existing verses, as before
    const verseData: Verse[] = []
    for (const doc of results) {
      const verse = (doc as unknown as Verse[] | null)?.[0]
      if (!verse) {
        break
      }
      verseData.push(verse)
    }

    // A range whose first verse is missing returns 404, not an empty 200. The
    // previous `if (verseData)` was always true (an empty array is truthy), so
    // this endpoint used to answer 200 [] for a range that does not exist.
    if (verseData.length > 0) {
      return res.json(verseData)
    }
  }

  res.status(404).json({ error: "Verse not found" })
}
