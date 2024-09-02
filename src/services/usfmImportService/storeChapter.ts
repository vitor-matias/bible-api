import type { createClient } from "redis"
import { storeVerse } from "./storeVerse"

const compareVerseLabels = (
  a: [string, USFMVerse],
  b: [string, USFMVerse],
): number => {
  const parseKey = (key: string) => {
    // Handle numeric parts, taking the first part if it's a compound key like "8-9"
    const numPart = Number.parseInt(key.split("-")[0])
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
  chapterNumber: number,
  chapter: USFMChapter,
): Promise<void> => {
  let verseNumber = 1

  for (const [verseLabel, verse] of Object.entries(chapter).sort(
    compareVerseLabels,
  )) {
    if (verse.verseObjects.some((verseObject) => verseObject.tag === "ms")) {
      console.log(bookCode)
      console.log(chapterNumber)
      console.log(verse.verseObjects)

      let objectsForVerse: USFMVerseObject[] = []
      verseNumber = verseLabel === "front" ? 0 : verseNumber
      let labelForVerse = verseLabel.includes("-") ? "" : verseNumber.toString()

      for (const verseObject of Object.values(verse.verseObjects)) {
        if (verseObject.tag === "va") {
          if (labelForVerse !== "") {
            await storeVerse(
              client,
              bookCode,
              chapterNumber,
              verseNumber,
              labelForVerse,
              objectsForVerse,
            )
            objectsForVerse = []

            verseNumber++
          }
          labelForVerse = verseObject?.content as string
        } else {
          objectsForVerse.push(verseObject)
        }
      }

      if (labelForVerse !== "") {
        await storeVerse(
          client,
          bookCode,
          chapterNumber,
          verseNumber,
          labelForVerse,
          objectsForVerse,
        )
        verseNumber++
      }
    } else if (verseLabel !== "front") {
      await storeVerse(
        client,
        bookCode,
        chapterNumber,
        verseNumber,
        verseLabel,
        verse.verseObjects,
      )
      verseNumber++
    } else {
      await storeVerse(
        client,
        bookCode,
        chapterNumber,
        0,
        verseLabel,
        verse.verseObjects,
      )
    }
  }
  if (chapter.front === null) {
    await storeVerse(client, bookCode, chapterNumber, 0, "front", [])
  }
}
