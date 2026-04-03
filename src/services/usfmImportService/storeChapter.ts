import type { createClient } from "redis"
import { generateEmbeddings } from "../openai/embeddings"
import { extractVerseText, storeVerse } from "./storeVerse"

const compareVerseLabels = (
  a: [string, USFMVerse],
  b: [string, USFMVerse],
): number => {
  const parseKey = (key: string) => {
    // Handle numeric parts, taking the first part if it's a compound key like "8-9"
    const numPart = Number.parseInt(key.split("-")[0], 10)
    // If it's not a number (like "front"), return Infinity to sort it first
    return Number.isNaN(numPart) ? Number.NEGATIVE_INFINITY : numPart
  }
  const aValue = parseKey(a[0])
  const bValue = parseKey(b[0])

  // Sort numerically for valid numeric keys, otherwise keep their original order
  return aValue - bValue
}

export const storeChapter = async (
  client: ReturnType<typeof createClient>,
  bookCode: string,
  bookNumber: number,
  chapterNumber: number,
  chapter: USFMChapter,
): Promise<void> => {
  let verseNumber = 1
  const versesData: {
    verseData: Verse
    text: string
  }[] = []

  // Tracks an empty quote (like \q1) that appears at the end of a verse, so it can
  // be applied to the beginning of the next verse.
  let pendingQuote: USFMVerseObject | null = null

  for (const [verseLabel, verse] of Object.entries(chapter).sort(
    compareVerseLabels,
  )) {
    // If the previous verse ended with an empty quote block, apply its tag
    // to the first object of the current verse if it's plain text.
    // USFM authors sometimes place a quote tag (e.g. \q1) before a verse marker (\v)
    // to style the upcoming verse, but the parser assigns that empty quote to the
    // end of the *previous* verse. This retroactively fixes that.
    if (pendingQuote) {
      pendingQuote.text = "\u200B"
      verse.verseObjects.unshift(pendingQuote)
      pendingQuote = null
    }

    // Check if the current verse ends with an empty quote block.
    // If so, remove it from this verse and save it as pending
    // so it can be applied to the beginning of the next verse instead.
    if (verse.verseObjects.length > 0) {
      const lastObj = verse.verseObjects[verse.verseObjects.length - 1]
      if (
        lastObj.type === "quote" &&
        (!lastObj.text || lastObj.text.trim() === "")
      ) {
        pendingQuote = lastObj
        verse.verseObjects.pop()
      }
    }

    if (verse.verseObjects.some((verseObject) => verseObject.tag === "ms")) {
      let objectsForVerse: USFMVerseObject[] = []
      verseNumber = verseLabel === "front" ? 0 : verseNumber
      let labelForVerse = verseLabel.includes("-") ? "" : verseNumber.toString()

      for (const verseObject of Object.values(verse.verseObjects)) {
        if (verseObject.tag === "va") {
          if (labelForVerse !== "") {
            const verseData = await storeVerse(
              client,
              bookCode,
              bookNumber,
              chapterNumber,
              verseNumber,
              labelForVerse,
              objectsForVerse,
            )
            if (verseNumber > 0) {
              const text = extractVerseText(verseData)
              if (text.trim().length > 0) {
                versesData.push({ verseData, text })
              }
            }
            objectsForVerse = []

            verseNumber++
          }
          labelForVerse = verseObject?.content as string
        } else {
          objectsForVerse.push(verseObject)
        }
      }

      if (labelForVerse !== "") {
        const verseData = await storeVerse(
          client,
          bookCode,
          bookNumber,
          chapterNumber,
          verseNumber,
          labelForVerse,
          objectsForVerse,
        )
        if (verseNumber > 0) {
          const text = extractVerseText(verseData)
          if (text.trim().length > 0) {
            versesData.push({ verseData, text })
          }
        }
        verseNumber++
      }
    } else if (verseLabel !== "front") {
      const verseData = await storeVerse(
        client,
        bookCode,
        bookNumber,
        chapterNumber,
        verseNumber,
        verseLabel,
        verse.verseObjects,
      )
      if (verseNumber > 0) {
        const text = extractVerseText(verseData)
        if (text.trim().length > 0) {
          versesData.push({ verseData, text })
        }
      }
      verseNumber++
    } else {
      await storeVerse(
        client,
        bookCode,
        bookNumber,
        chapterNumber,
        0,
        verseLabel,
        verse.verseObjects,
      )
    }
  }
  if (chapter.front === null) {
    await storeVerse(
      client,
      bookCode,
      bookNumber,
      chapterNumber,
      0,
      "front",
      [],
    )
  }

  // Generate embeddings in batch for all verses in the chapter
  if (false) {
    const texts = versesData.map((v) => v.text)

    console.log(
      `Generating embeddings for chapter ${chapterNumber} with ${texts.length} verses...`,
    )
    try {
      const embeddings = await generateEmbeddings(texts)

      // Store all embeddings
      for (let i = 0; i < versesData.length; i++) {
        const v = versesData[i].verseData
        if (embeddings[i] && embeddings[i].length > 0) {
          await client.json.set(
            `embedding:${v.bookId}:${v.chapterNumber}:${v.number}`,
            "$",
            {
              key: `verse:${v.bookId}:${v.chapterNumber}:${v.number}`,
              embedding: embeddings[i],
            },
          )
        }
      }
    } catch (error) {
      console.error(
        `Failed to generate embeddings for chapter ${chapterNumber}:`,
        error,
      )
    }
  }
}
