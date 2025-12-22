import type { createClient } from "redis"
import { normalizeText } from "../../util/normalizeText"
import { generateEmbedding } from "../openai/embeddings"
import { getVerse } from "../verse/getVerse"

export const storeVerse = async (
  client: ReturnType<typeof createClient>,
  bookId: string,
  bookNumber: number,
  chapterNumber: number,
  verseNumber: number,
  verseLabel: string,
  verseObjects: USFMVerseObject[],
): Promise<void> => {
  const searchId = `${String(bookNumber).padStart(2, "0")}-${String(chapterNumber).padStart(3, "0")}-${String(verseNumber).padStart(3, "0")}`
  const verseData: Verse = (await getVerse(
    client,
    bookId,
    chapterNumber,
    verseNumber,
  )) || {
    bookId,
    searchId,
    chapterNumber,
    number: verseNumber,
    text: [],
    numberLabel: verseLabel,
  }

  for (const verseObject of verseObjects) {
    if (
      (verseObject.type === "text" || verseObject?.tag === "nd") &&
      verseObject.text
    ) {
      const text = verseObject.text?.replace(/[*\n]/g, "")
      verseData.text.push({
        type: "text",
        text,
        normalizedText: normalizeText(text),
        allCaps: verseObject?.tag === "nd",
      })
    } else if (verseObject.type === "quote") {
      const text = verseObject.text?.replace(/[*\n]/g, "") ?? ""
      verseData.text.push({
        type: "quote",
        text,
        normalizedText: normalizeText(text),
        identLevel: Number.parseInt(verseObject.tag?.split("q")[1] ?? "1", 10),
      })
    } else if (
      verseObject.type === "paragraph" &&
      (verseObject.nextChar || verseObject.text)
    ) {
      const text = verseObject.nextChar ?? verseObject.text ?? ""
      verseData.text.push({
        type: "paragraph",
        text,
        normalizedText: normalizeText(text),
      })
    } else if (verseObject.type === "section" || verseObject.tag === "ms") {
      const text = verseObject.content?.replace(/[*\n]/g, "") ?? ""

      verseData.text.push({
        type: "section",
        tag: verseObject.tag ?? "s2",
        text,
        normalizedText: normalizeText(text),
      })

      if (verseObject.type === "section") {
        await saveChapterTitle(
          client,
          bookId,
          chapterNumber,
          text,
          verseObject.tag === "s1",
        )
      }
    } else if (verseObject.tag === "r" || verseObject.tag === "sr") {
      const text = verseObject.content?.replace(/[*\n]/g, "") ?? ""
      verseData.text.push({
        type: "references",
        text,
        normalizedText: normalizeText(text),
      })
    } else if (verseObject.tag === "f") {
      const text = verseObject.content?.replace(/[*\n]/g, "") ?? ""
      // Split by \fp (new footnote marker)
      const footnoteParts = text.split(/\\fp\s*/)
      for (const part of footnoteParts) {
        // Extract \fr ... \ft ... from each part
        const frMatch = part.match(/\\fr\s+([^\\]+?)\s*\\ft/)
        const ftMatch = part.match(/\\ft\s+([^\\]+?)(?=(\\fr|\\f\*|$))/)
        if (frMatch && ftMatch) {
          const footnoteReference = frMatch[1].trim()
          const footnoteText = ftMatch[1].trim()
          verseData.text.push({
            type: "footnote",
            text: footnoteText,
            reference: footnoteReference,
          })
        }
      }
    }
  }

  await client.json.set(
    `verse:${bookId}:${chapterNumber}:${verseNumber}`,
    "$",
    verseData,
  )
  if (verseNumber > 0) {
    const verseText = verseData.text
      .filter(
        (t) =>
          t.type === "text" || t.type === "quote" || t.type === "paragraph",
      )
      .map((t) => t.text.trim())
      .join(" ")

    const embedding = await generateEmbedding(verseText)

    await client.json.set(
      `embedding:${bookId}:${chapterNumber}:${verseNumber}`,
      "$",
      {
        key: `verse:${bookId}:${chapterNumber}:${verseNumber}`,
        embedding: embedding,
      },
    )
  }
}

export const saveChapterTitle = async (
  client: ReturnType<typeof createClient>,
  bookId: string,
  chapterNumber: number,
  title: string,
  overlap = false,
) => {
  const currentTitle = await client.get(
    `chapterTitle:${bookId}:${chapterNumber}`,
  )

  if (!currentTitle || overlap) {
    await client.set(`chapterTitle:${bookId}:${chapterNumber}`, title)
  }
}
