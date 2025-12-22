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

  for (const [verseLabel, verse] of Object.entries(chapter).sort(
    compareVerseLabels,
  )) {
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
  if (versesData.length > 0) {
    const texts = versesData.map((v) => v.text)

    console.log(`Generating embeddings for chapter ${chapterNumber} with ${texts.length} verses...`)
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
