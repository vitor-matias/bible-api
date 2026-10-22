import type { createClient } from "redis"
import { getJson, setJson } from "../../util/jsonStore"
import type { DocumentChunk } from "../voyage/embeddings"
import type { VerseForEmbedding } from "./storeChapter"

type Client = ReturnType<typeof createClient>

// Section headings nest, outermost first: a part (\ms), a division (\s1), a
// section (\s2) and, rarely, a subsection (\s3). A heading replaces its own
// level and clears the ones below it, so the outline in effect at a verse is
// the latest heading at each level. Divisions often span chapters (the Sermon
// on the Mount runs through Matthew 5-7), and some chapters open mid-section,
// so each chapter's outline starts where the previous chapter's ended.
type Outline = [string, string, string, string]

type ChapterOutline = { start: Outline; end: Outline }

const EMPTY_OUTLINE: Outline = ["", "", "", ""]

const headingLevel = (tag: string): number => {
  if (tag.startsWith("ms")) return 0
  const depth = Number(tag.slice(1))
  return Number.isInteger(depth) && depth >= 1 ? Math.min(depth, 3) : 2
}

const applyHeadings = (outline: Outline, verses: Verse[]): Outline => {
  const next: Outline = [...outline]
  for (const verse of verses) {
    for (const item of verse.text) {
      if (item.type !== "section" || !item.text.trim()) continue
      const level = headingLevel(item.tag)
      next[level] = item.text.trim()
      next.fill("", level + 1)
    }
  }
  return next
}

export const chapterOutlineKey = (bookId: string, chapterNumber: number) =>
  `chapterOutline:${bookId}:${chapterNumber}`

const getChapterOutline = async (
  client: Client,
  bookId: string,
  chapterNumber: number,
): Promise<ChapterOutline | null> =>
  getJson<ChapterOutline>(client, chapterOutlineKey(bookId, chapterNumber))

// Records the outline at the start and end of a chapter from all of its
// stored verses, verse 0 included: headings that open a chapter sit there.
// Called during the import's sequential storage pass, never from the
// background embedding tasks, so the previous chapter's outline is always
// stored by the time this one reads it.
export const saveChapterOutline = async (
  client: Client,
  bookId: string,
  chapterNumber: number,
  verses: Verse[],
): Promise<void> => {
  const previous = await getChapterOutline(client, bookId, chapterNumber - 1)
  const start = applyHeadings(
    previous?.end ?? EMPTY_OUTLINE,
    verses.filter((v) => v.number === 0),
  )
  const end = applyHeadings(
    start,
    verses.filter((v) => v.number > 0),
  )
  await setJson(client, chapterOutlineKey(bookId, chapterNumber), {
    start,
    end,
  })
}

const isContent = (item: Verse["text"][number]) =>
  (item.type === "text" ||
    item.type === "quote" ||
    item.type === "paragraph") &&
  item.text.replace(/\u200B/g, "").trim() !== ""

// The document a chapter is embedded as. It opens with the book, chapter and
// outline in effect there, e.g. "Evangelho de São Mateus, capítulo 6: Sermão
// da Montanha — A esmola"; each later heading follows as a chunk of its own
// where its section starts, which is after the verse the parser attached it
// to when it trails that verse's text. Only verse chunks get a vector; the
// rest is context. Both the import and the retry path build it from what is
// stored, so a re-embedded chapter gets the same document.
export const chapterDocument = async (
  client: Client,
  versesData: VerseForEmbedding[],
): Promise<DocumentChunk[]> => {
  const { bookId, chapterNumber } = versesData[0].verseData
  const [book, outline] = await Promise.all([
    getJson<Pick<Book, "name">>(client, `book:${bookId}`),
    getChapterOutline(client, bookId, chapterNumber),
  ])
  const bookName = book?.name ?? ""
  const chapter =
    bookId === "psa" ? `Salmo ${chapterNumber}` : `capítulo ${chapterNumber}`
  const place = [bookName, chapter].filter(Boolean).join(", ")
  const headings = (outline?.start ?? EMPTY_OUTLINE).filter(Boolean)

  const chunks: DocumentChunk[] = [
    {
      text: headings.length ? `${place}: ${headings.join(" — ")}` : place,
      embed: false,
    },
  ]
  for (const { verseData, text } of versesData) {
    const before: DocumentChunk[] = []
    const after: DocumentChunk[] = []
    let seenContent = false
    for (const item of verseData.text) {
      if (item.type === "section") {
        ;(seenContent ? after : before).push({ text: item.text, embed: false })
      } else if (isContent(item)) {
        seenContent = true
      }
    }
    chunks.push(...before, { text, embed: true }, ...after)
  }
  return chunks
}
