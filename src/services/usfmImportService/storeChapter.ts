import type { createClient } from "redis"
import { chapterVerseMaxKey } from "../chapter/verseCountKey"
import { generateEmbeddings } from "../openai/embeddings"
import { extractVerseText, storeVerse } from "./storeVerse"

// Repeated failures indicate a systemic problem (bad OPENAI_API_KEY, outage)
// rather than a transient one, so the import aborts instead of silently
// producing a corpus without embeddings.
const MAX_CONSECUTIVE_EMBEDDING_FAILURES = 3
let consecutiveEmbeddingFailures = 0
let embeddingFailureCount = 0

// Chapters whose embeddings failed transiently during this import; semantic
// search misses their verses until a reimport.
export const getEmbeddingFailureCount = () => embeddingFailureCount

type VerseForEmbedding = {
  verseData: Verse
  text: string
}

// Single definition of what qualifies for the semantic index: real verses
// (verse 0 is the "front" pseudo-verse) that carry some text.
const collectForEmbedding = (
  versesData: VerseForEmbedding[],
  verseData: Verse,
  verseNumber: number,
): void => {
  if (verseNumber <= 0) return

  const text = extractVerseText(verseData)
  if (text.trim().length > 0) {
    versesData.push({ verseData, text })
  }
}

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
  const versesData: VerseForEmbedding[] = []

  // Tracks an empty quote (like \q1) that appears at the end of a verse, so it can
  // be applied to the beginning of the next verse.
  let pendingQuote: USFMVerseObject | null = null

  const verseEntries = Object.entries(chapter).sort(compareVerseLabels)

  for (const [index, [verseLabel, verse]] of verseEntries.entries()) {
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
    // The last verse keeps its trailing quote: there is no next verse to move
    // it to, and stashing it there would drop it entirely.
    const hasNextVerse = index < verseEntries.length - 1
    if (hasNextVerse && verse.verseObjects.length > 0) {
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
            collectForEmbedding(versesData, verseData, verseNumber)
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
        collectForEmbedding(versesData, verseData, verseNumber)
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
      collectForEmbedding(versesData, verseData, verseNumber)
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

  // Record the chapter's highest verse number so getChapter can address the
  // verse keys directly instead of scanning the keyspace for them.
  await client.set(
    chapterVerseMaxKey(bookCode, chapterNumber),
    String(Math.max(0, verseNumber - 1)),
  )

  // Generate embeddings in batch for all verses in the chapter
  if (versesData.length > 0) {
    const texts = versesData.map((v) => v.text)

    console.log(
      `Generating embeddings for chapter ${chapterNumber} with ${texts.length} verses...`,
    )
    try {
      const embeddings = await generateEmbeddings(texts)

      // Store all embeddings in one pipelined round trip
      const multi = client.multi()
      for (let i = 0; i < versesData.length; i++) {
        const v = versesData[i].verseData
        if (embeddings[i] && embeddings[i].length > 0) {
          multi.json.set(
            `embedding:${v.bookId}:${v.chapterNumber}:${v.number}`,
            "$",
            {
              key: `verse:${v.bookId}:${v.chapterNumber}:${v.number}`,
              embedding: embeddings[i],
            },
          )
        }
      }
      await multi.exec()
      consecutiveEmbeddingFailures = 0
    } catch (error) {
      embeddingFailureCount++
      consecutiveEmbeddingFailures++
      console.error(
        `Failed to generate embeddings for chapter ${chapterNumber}:`,
        error,
      )
      // A missing/invalid API key or an OpenAI outage would otherwise fail
      // every chapter one by one, leaving the whole corpus without embeddings.
      if (consecutiveEmbeddingFailures >= MAX_CONSECUTIVE_EMBEDDING_FAILURES) {
        throw new Error(
          `Embedding generation failed for ${consecutiveEmbeddingFailures} chapters in a row — aborting import. Last error: ${error}`,
        )
      }
    }
  }
}
