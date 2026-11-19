// Maps the +365 podcast (EJNS Portugal, a Bible-in-a-year reading) onto
// chapters: which episode reads a chapter, and where in it the reading starts.
// Episodes are only streamed from the podcast's own host, never stored here.

export type BookName = { id: string; shortName: string; chapterCount: number }
export type Reading = { bookId: string; chapter: number }
export type Segment = { start: number; text: string }

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

const namesOf = (book: BookName) => [
  normalize(book.shortName),
  ...(ALIASES[book.id] ?? []),
]

const findBook = (name: string, books: BookName[]) => {
  const wanted = normalize(name)
  return books.find((book) => namesOf(book).includes(wanted))
}

// "5", "10–11", "26:27-28", "22:39–24:50", "20–22:38": the chapters read.
const chaptersOf = (numbers: string, book: BookName): number[] => {
  const match = /^(\d+)(?::(\d+))?(?:\s*[–-]\s*(\d+)(?::(\d+))?)?/.exec(numbers)
  if (!match) return book.chapterCount === 1 ? [1] : []
  const first = Number(match[1])
  // A second number is a verse when the first had one and it has none.
  const last =
    match[3] === undefined || (match[2] !== undefined && match[4] === undefined)
      ? first
      : Number(match[3])
  const chapters: number[] = []
  for (let c = first; c <= Math.min(last, book.chapterCount); c++) {
    chapters.push(c)
  }
  return chapters
}

/**
 * The readings an episode description announces, e.g. "Hoje vamos ler
 * Génesis 37; Job 27–28; Provérbios 3:25-27." Parts it cannot place are
 * returned in `unparsed`, so the caller can report them instead of guessing.
 */
export const parseReadings = (
  description: string,
  books: BookName[],
): { readings: Reading[]; unparsed: string[] } => {
  const text = description.replace(/<[^>]+>/g, " ")
  const announced = /vamos (?:ler|ouvir)\s*:?\s*([\s\S]*?)(?:\.(?!\d)|$)/.exec(
    text,
  )
  const readings: Reading[] = []
  const unparsed: string[] = []
  if (!announced) return { readings, unparsed }

  let book: BookName | undefined
  for (const raw of announced[1].split(/;|,|\s+e\s+/)) {
    const part = raw.trim().replace(/^(?:o|a|os|as)\s+/i, "")
    // Ester's Greek additions are lettered (Ester 5, D, 6–7) and have no
    // chapter number here.
    if (part === "" || /^[A-F]$/.test(part)) continue
    const named = /^((?:[1-3]\s*)?[^\d]+?)\s*(\d.*)?$/.exec(part)
    const namedBook = named && findBook(named[1], books)
    if (namedBook) book = namedBook
    const numbers = namedBook ? (named[2] ?? "") : part
    const chapters =
      book && /^\d|^$/.test(numbers) ? chaptersOf(numbers, book) : []
    if (!book || chapters.length === 0) {
      unparsed.push(part)
      continue
    }
    for (const chapter of chapters) readings.push({ bookId: book.id, chapter })
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
  return readings.map(({ bookId, chapter }) => {
    const book = books.find((b) => b.id === bookId)
    if (!book) return undefined
    const headings = namesOf(book).map((name) => `${name} ${chapter}`)
    for (let i = cursor; i < segments.length; i++) {
      const said = asShortName(normalize(segments[i].text))
      if (headings.some((h) => said === h || said.startsWith(`${h} `))) {
        cursor = i + 1
        return segments[i].start
      }
    }
    return undefined
  })
}
