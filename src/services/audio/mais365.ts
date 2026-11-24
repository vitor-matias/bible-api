// Maps the +365 podcast (EJNS Portugal, a Bible-in-a-year reading) onto
// chapters: which episode reads a chapter, and where in it the reading starts.
// Episodes are only streamed from the podcast's own host, never stored here.

export type BookName = { id: string; shortName: string; chapterCount: number }
/** A chapter read, or only `verses` [first, last] of it (Provérbios 1:1-7). */
export type Reading = {
  bookId: string
  chapter: number
  verses?: [number, number]
}
/** A stretch of the transcript; `end` is known for Whisper's own segments. */
export type Segment = { start: number; end?: number; text: string }

export const normalize = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()

// How the descriptions and the readers name a book besides its short name.
const ALIASES: Record<string, string[]> = {
  psa: ["salmo"],
  job: ["jo"],
  act: ["atos"],
  oba: ["obadias"],
  est: ["esther"],
}

// Readers say "2º Livro dos Reis 25" or "Segundo o livro das Crónicas, 36"
// for what the books list calls "2 Reis" and "2 Crónicas".
const ORDINALS = /^(primeiro|segundo|terceiro)\b/
const asShortName = (said: string): string =>
  said
    .replace(ORDINALS, (word) =>
      String(["primeiro", "segundo", "terceiro"].indexOf(word) + 1),
    )
    .replace(/^(\d )?(?:o )?livro d[aeo]s? /, "$1")

// Whisper now and then writes a heading's number as a numeral: "Jó I".
const ROMAN = [
  "i",
  "ii",
  "iii",
  "iv",
  "v",
  "vi",
  "vii",
  "viii",
  "ix",
  "x",
  "xi",
  "xii",
]
const arabicTail = (said: string): string =>
  said.replace(/ ([ivx]+)$/, (whole, numeral: string) => {
    const value = ROMAN.indexOf(numeral) + 1
    return value ? ` ${value}` : whole
  })

const namesOf = (book: BookName) => [
  normalize(book.shortName),
  ...(ALIASES[book.id] ?? []),
]

const findBook = (name: string, books: BookName[]) => {
  const wanted = normalize(name)
  return books.find((book) => namesOf(book).includes(wanted))
}

// "5", "10–11", "26:27-28", "22:39–24:50", "20–22:38": the chapters read.
const readingsOf = (numbers: string, book: BookName): Reading[] => {
  const match = /^(\d+)(?::(\d+))?(?:\s*[–-]\s*(\d+)(?::(\d+))?)?/.exec(numbers)
  if (!match)
    return book.chapterCount === 1 ? [{ bookId: book.id, chapter: 1 }] : []
  const first = Number(match[1])
  // A second number is a verse when the first had one and it has none.
  const inOne =
    match[3] === undefined || (match[2] !== undefined && match[4] === undefined)
  if (inOne && match[2] !== undefined) {
    // "1:1-7" (or "3:5"): part of one chapter, those verses.
    const from = Number(match[2])
    const to = match[3] === undefined ? from : Number(match[3])
    return [{ bookId: book.id, chapter: first, verses: [from, to] }]
  }
  const last = inOne ? first : Number(match[3])
  const readings: Reading[] = []
  for (let c = first; c <= Math.min(last, book.chapterCount); c++) {
    readings.push({ bookId: book.id, chapter: c })
  }
  return readings
}

/** Up to the first full stop that ends a sentence, not a "3.5" in a number. */
const untilSentenceEnd = (text: string): string => {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "." && !/\d/.test(text[i + 1] ?? ""))
      return text.slice(0, i)
  }
  return text
}

/**
 * The readings an episode description announces, e.g. "Hoje vamos ler
 * Génesis 37; Job 27–28; Provérbios 3:25-27." Parts it cannot place are
 * returned in `unparsed`, so the caller can report them instead of guessing.
 */
/** The sentence that lists the day's readings, without what leads to it. */
const announcementOf = (description: string): string | null => {
  // Tags out, whitespace in one run: what follows reads plain text. Each
  // pattern here is linear, so a hostile description can't stall the parse.
  const text = description.replace(/<[^<>]*>/g, " ").replace(/\s+/g, " ")
  // "Hoje vamos ler …", or "Hoje lemos: …" (as from Dia 28).
  const after = /vamos (?:ler|ouvir)|\blemos\b/.exec(text)
  if (!after) return null
  return untilSentenceEnd(
    text.slice(after.index + after[0].length).replace(/^[ :]+/, ""),
  )
}

export const parseReadings = (
  description: string,
  books: BookName[],
): { readings: Reading[]; unparsed: string[] } => {
  const announced = announcementOf(description)
  const readings: Reading[] = []
  const unparsed: string[] = []
  if (announced === null) return { readings, unparsed }

  let book: BookName | undefined
  for (const raw of announced.split(/;|,| e /)) {
    const part = raw.trim().replace(/^(?:o|a|os|as)\s+/i, "")
    // Ester's Greek additions are lettered (Ester 5, D, 6–7) and have no
    // chapter number here.
    if (part === "" || /^[A-F]$/.test(part)) continue
    // "1 Samuel 21-22": the name runs to the first digit after any "1 ".
    const prefix = /^[1-3] ?/.exec(part)?.[0] ?? ""
    const digit = part.slice(prefix.length).search(/\d/)
    const split = digit < 0 ? part.length : prefix.length + digit
    const namedBook = findBook(part.slice(0, split).trim(), books)
    if (namedBook) book = namedBook
    const numbers = namedBook ? part.slice(split) : part
    const found =
      book && /^\d|^$/.test(numbers) ? readingsOf(numbers, book) : []
    if (!book || found.length === 0) {
      unparsed.push(part)
      continue
    }
    readings.push(...found)
  }
  return { readings, unparsed }
}

/**
 * Where each reading starts in the episode. The readers announce every
 * chapter on its own ("Génesis 5", "Salmo 136") before reading it, so the
 * start is the transcript segment that opens with that heading. Headings are
 * looked for in reading order, each after the last one found, so the priest's
 * commentary, which follows the readings, cannot claim one.
 */
export const findChapterStarts = (
  segments: Segment[],
  readings: Reading[],
  books: BookName[],
): (number | undefined)[] => {
  let cursor = 0
  const starts = readings.map(({ bookId, chapter, verses }) => {
    const book = books.find((b) => b.id === bookId)
    if (!book) return undefined
    const headings = namesOf(book).map((name) => `${name} ${chapter}`)
    // Read in part, its verses alone can be all Whisper keeps of the heading
    // ("Provérbios 1, 1 a 7" heard as "1 a 7").
    const range = verses && `${verses[0]} a ${verses[1]}`
    for (let i = cursor; i < segments.length; i++) {
      const said = arabicTail(asShortName(normalize(segments[i].text)))
      if (
        headings.some((h) => said === h || said.startsWith(`${h} `)) ||
        said === range
      ) {
        cursor = i + 1
        return segments[i].start
      }
    }
    return undefined
  })
  // The first chapter is often read without its heading, straight after the
  // sentence that announces the day's readings.
  if (starts[0] === undefined) {
    const announced = segments.findIndex((s) =>
      /vamos (?:ler|ouvir)|\blemos\b/.test(normalize(s.text)),
    )
    const closes = segments.findIndex(
      (s, i) => i >= announced && s.text.trim().endsWith("."),
    )
    const first = announced < 0 || closes < 0 ? undefined : segments[closes + 1]
    const next = starts.find((s) => s !== undefined)
    if (first && (next === undefined || first.start < next))
      starts[0] = first.start
  }
  return starts
}

/**
 * Where a chapter's reading ends: the last transcript segment, after its
 * start and before the next chapter's, that says the closing words of its
 * last verse. Failing that (Whisper wrote a number as digits, say), the next
 * chapter's start; a last reading with neither stays unknown.
 */
export const findChapterEnd = (
  segments: Segment[],
  start: number,
  nextStart: number | undefined,
  lastVerse: string,
): number | undefined => {
  const words = normalize(lastVerse).split(" ").filter(Boolean)
  const within = segments.filter(
    (s) => s.start >= start && (nextStart === undefined || s.start < nextStart),
  )
  // Joined, as the closing words can straddle two segments ("… o Senhor" |
  // "Aleluia"); each segment's place in the join finds who said the last word.
  let joined = ""
  const at = within.map((segment) => {
    const offset = joined.length
    joined += ` ${normalize(segment.text)}`
    return offset
  })
  joined += " "
  for (const size of [3, 2]) {
    if (words.length < size) continue
    const found = joined.lastIndexOf(` ${words.slice(-size).join(" ")} `)
    if (found < 0) continue
    const lastWord = found + words.slice(-size).join(" ").length
    // Offsets ascend, so the ones up to the last word end at its segment.
    const index = at.filter((offset) => offset <= lastWord).length - 1
    const segment = within[index]
    const next = segments[segments.indexOf(segment) + 1]
    return segment.end ?? next?.start ?? segment.start
  }
  return nextStart
}
