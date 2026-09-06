import type { createClient } from "redis"
import { normalizeText } from "../../util/normalizeText"
import { getVerse } from "../verse/getVerse"

// Only ASCII whitespace is folded. Footnote prose uses non-breaking spaces
// deliberately (  inside references such as "Sl 104,3"), so those are left
// exactly as the source wrote them.
const collapseWhitespace = (value: string): string =>
  value.replace(/[\t\n\r ]+/g, " ").trim()

// \ft introduces the note body and \bd / \bdit only style it, so the markers
// themselves are dropped and the text they wrap is kept.
const FOOTNOTE_MARKERS = /\\[a-z0-9+]+\*?/gi

// The caller that opens a note's content ("+" in `\f + \fr 1.1 \ft ...\f*").
const FOOTNOTE_CALLER = /^\s*[+\-?]\s*/

/**
 * Reads one footnote part into its reference and body.
 *
 * The body is whatever follows \fr's value. Everything before it is the caller
 * or a decorative marker — sources in the wild write
 * `\f + \ft ❑ \fr 7. \ft Ver Lc 4,18.\f*`, where the first \ft holds "❑" and the
 * note itself only appears after the reference. Anchoring on the reference
 * rather than on the first \ft is what keeps that note from being lost.
 *
 * `isContinuation` marks the parts after a \fp: those open a new paragraph of
 * the same note, so they carry neither a caller nor a reference, and often no
 * \ft either — their text follows the marker directly.
 *
 * Returns null when the part has no body, which is not a note worth storing.
 */
const parseFootnotePart = (
  part: string,
  isContinuation: boolean,
): _Footnote | null => {
  const frMatch = /\\fr\s+([^\\]*)/.exec(part)

  const body = frMatch
    ? part.slice(frMatch.index + frMatch[0].length)
    : isContinuation
      ? part
      : part.replace(FOOTNOTE_CALLER, "")

  const text = collapseWhitespace(body.replace(FOOTNOTE_MARKERS, " "))
  if (!text) return null

  // \fr is optional in USFM, and \fp paragraphs never repeat it, so a note
  // without one keeps its text instead of being discarded.
  return {
    type: "footnote",
    text,
    reference: frMatch ? collapseWhitespace(frMatch[1]) : "",
  }
}

export const storeVerse = async (
  client: ReturnType<typeof createClient>,
  bookId: string,
  bookNumber: number,
  chapterNumber: number,
  verseNumber: number,
  verseLabel: string,
  verseObjects: USFMVerseObject[],
): Promise<Verse> => {
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
      // \fp opens an additional paragraph of the same note; each part becomes
      // its own footnote entry. Asterisks survive: they are stripped only as
      // part of a closing marker, so a literal "*" in the prose is kept.
      const parts = (verseObject.content ?? "").split(/\\fp\s*/)
      for (const [index, part] of parts.entries()) {
        const footnote = parseFootnotePart(part, index > 0)
        if (footnote) {
          verseData.text.push(footnote)
        }
      }
    }
  }

  await client.json.set(
    `verse:${bookId}:${chapterNumber}:${verseNumber}`,
    "$",
    verseData,
  )
  return verseData
}

/**
 * Extracts the plain text content from a verse for embedding generation.
 * Includes text, quote, paragraph, and section types; excludes footnotes and references.
 */
export const extractVerseText = (verseData: Verse): string => {
  return verseData.text
    .filter(
      (t) =>
        t.type === "text" ||
        t.type === "quote" ||
        t.type === "paragraph" ||
        t.type === "section",
    )
    .map((t) => t.text.trim())
    .join(" ")
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
