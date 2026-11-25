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
  // How Whisper mishears headings, again and again: "Ozeias 10", "Jusué 5".
  hos: ["ozeias", "edeias", "euseias"],
  jos: ["jusue"],
  sir: ["benesira"],
  exo: ["a exodo", "a isodo", "autodo", "eis o do"],
  deu: ["patinomio"],
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
    const heading = (said: string) =>
      headings.some(
        (h) =>
          said === h ||
          // Not the day's announcement listing it: "Jó 29 e 30", "3, 28 a 32".
          (said.startsWith(`${h} `) && !/^ [ea] \d/.test(said.slice(h.length))),
      ) ||
      said === range ||
      // The book's name dropped, the number alone: "41".
      said === String(chapter)
    for (let i = cursor; i < segments.length; i++) {
      // A heading can straddle segments: "Levítico" | "24", "Cântico" |
      // "dos Cânticos" | "8".
      const joined = [1, 2, 3].map((size) =>
        arabicTail(
          asShortName(
            normalize(
              segments
                .slice(i, i + size)
                .map((s) => s.text)
                .join(" "),
            ),
          ),
        ),
      )
      if (joined.some(heading)) {
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

const REPEAT_GAP = 30

/**
 * Where a chapter read without its heading starts: the first segment, from
 * `from` and before `to`, that says its first verse's opening words.
 */
export const findChapterOpening = (
  segments: Segment[],
  from: number,
  to: number | undefined,
  firstVerse: string,
): number | undefined => {
  const words = normalize(firstVerse).split(" ").filter(Boolean)
  const within = segments.filter(
    (s) => s.start >= from && (to === undefined || s.start < to),
  )
  let joined = ""
  const at = within.map((segment) => {
    const offset = joined.length
    joined += ` ${normalize(segment.text)}`
    return offset
  })
  joined += " "
  // Then the words after a misheard first one ("Jusué estava velho").
  const openings = [words.slice(0, 5), words.slice(0, 4), words.slice(1, 5)]
  for (const opening of openings) {
    if (opening.length < 4) continue
    const found = joined.indexOf(` ${opening.join(" ")} `)
    if (found < 0) continue
    return within[at.filter((offset) => offset <= found).length - 1].start
  }
  return undefined
}

// Psalm 119's stanzas are headed by a Hebrew letter, which the text puts at
// the end of the verse before ("… instruções! \n Het").
const STANZA_LETTERS = new Set(
  "Alef Bet Guimel Dalet He Vau Zain Het Tet Yod Caf Lamed Mem Nun Samec Ain Phe Sadé Qof Resh Shin Tau".split(
    " ",
  ),
)
const withoutStanzaLetter = (verse: string): string => {
  const lines = verse.trimEnd().split("\n")
  const last = lines.at(-1)?.trim() ?? ""
  return lines.length > 1 && STANZA_LETTERS.has(last)
    ? lines.slice(0, -1).join("\n")
    : verse
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
  // The next start is the very next chapter's, not one after a chapter that
  // couldn't be placed.
  nextFollows = true,
): number | undefined => {
  const words = normalize(withoutStanzaLetter(lastVerse))
    .split(" ")
    .filter(Boolean)
    // Whisper writes "Amém" for the text's "Ámen".
    .map((word) => (word === "amen" ? "amem" : word))
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
  // The closing words, then those before a misheard last word ("Aarão" said
  // as "Arão").
  const phrases = [
    words.slice(-3),
    words.slice(-2),
    words.slice(-4, -1),
    words.slice(-3, -1),
  ].filter((phrase) => phrase.length >= 2)
  for (const phrase of phrases) {
    const said = ` ${phrase.join(" ")} `
    const found = joined.lastIndexOf(said)
    if (found < 0) continue
    const lastWord = found + said.length - 2
    // Offsets ascend, so the ones up to the last word end at its segment.
    const index = at.filter((offset) => offset <= lastWord).length - 1
    const segment = within[index]
    const next = segments[segments.indexOf(segment) + 1]
    const end = segment.end ?? next?.start ?? segment.start
    // Chapters follow within seconds: so far before the next one, the closing
    // words were said earlier in the chapter too, and not heard at its end.
    if (nextFollows && nextStart !== undefined && nextStart - end > REPEAT_GAP)
      break
    return end
  }
  return nextStart
}

/**
 * A run over some days laid over the plan before it: those days, and their
 * chapters' timings, replaced; every other day kept as it was.
 */
export const mergePlan = <
  Day extends { day: number },
  Timing extends { day: number },
>(
  before: { chapters: Record<string, Timing[]>; days: Day[] },
  run: { chapters: Record<string, Timing[]>; days: Day[] },
): { chapters: Record<string, Timing[]>; days: Day[] } => {
  const redone = new Set(run.days.map((day) => day.day))
  const chapters: Record<string, Timing[]> = {}
  // In the order they were, so a run over a day changes only its lines.
  for (const [key, entries] of Object.entries(before.chapters)) {
    chapters[key] = entries.filter((entry) => !redone.has(entry.day))
  }
  // Only days that finished: one that failed partway keeps its old timings.
  for (const [key, entries] of Object.entries(run.chapters)) {
    const done = entries.filter((entry) => redone.has(entry.day))
    chapters[key] = [...(chapters[key] ?? []), ...done]
  }
  for (const [key, entries] of Object.entries(chapters)) {
    if (entries.length === 0) delete chapters[key]
  }
  return {
    chapters,
    days: [...before.days.filter((day) => !redone.has(day.day)), ...run.days],
  }
}

/**
 * Whether Whisper dropped words in a reading: a segment over 10 s with
 * fewer than 1.3 words a second, where reading runs at about 2.5 (Marcos
 * 1:1-4, 24 s heard as 16 words). Names read slowly can look so too.
 */
export const losesWords = (
  segments: Segment[],
  start: number,
  end: number,
): boolean =>
  segments.some(
    (segment) =>
      segment.end !== undefined &&
      segment.start >= start - 0.6 &&
      segment.end <= end + 0.5 &&
      segment.end - segment.start > 10 &&
      segment.text.trim().split(/\s+/).length / (segment.end - segment.start) <
        1.3,
  )

/**
 * Verse 1 moved past the pause after a heading Whisper didn't hear on its
 * own («Marcos 16», «Êxodo 1»): placed from the heading, it was underlined
 * while the chapter was named. The heading is the sound before the first
 * pause of 0.4 s or more that starts within 3 s; verse 1 ends up 0.1 s
 * before that pause ends, if it was earlier and verse 2 is later still.
 */
export const pastHeadingPause = (
  verses: [number, number][],
  start: number,
  pauses: [number, number][],
): [number, number][] => {
  const pause = pauses.find(([from]) => from > start + 0.5 && from <= start + 3)
  const [first, second] = verses
  if (!pause || !first) return verses
  const after = Math.round((pause[1] - 0.1) * 100) / 100
  if (first[1] >= pause[1] - 0.3 || (second && after >= second[1])) {
    return verses
  }
  return [[first[0], after], ...verses.slice(1)]
}

/**
 * Where a chapter's reading begins after its heading: the segment after the
 * one that is just the heading («Marcos 1», starting at `start`), whose time
 * Whisper keeps even when it loses the words that follow (Marcos 1:1-3).
 * `start` when the heading runs on into the text.
 */
export const findReadingStart = (
  segments: Segment[],
  start: number,
  chapter: number,
): number => {
  const index = segments.findIndex(
    (segment) => Math.abs(segment.start - start) < 1,
  )
  const heading = segments[index]
  const next = segments[index + 1]
  const words = heading ? normalize(heading.text).split(" ") : []
  return next && words.length <= 3 && words.at(-1) === String(chapter)
    ? next.start
    : start
}

/**
 * Where a heading's chapter name is said, when the day's verses follow it
 * ("Provérbios 3, 1 a 4"): from just before the book's name to just before
 * the first verse's number. Found from the first verse back: the chapter's
 * number with a name before it and a number after. The segment the heading
 * starts in can begin seconds earlier (the reading before, the jingle) or,
 * heard as "1 a 7", after the name: so not from it. Undefined when the
 * heading names no verses or isn't in the words.
 */
export const findTitle = (
  words: { start: number; text: string }[],
  start: number,
  firstVerse: number,
  chapter: number,
): { start: number; end: number } | undefined => {
  const heading = words.filter(
    (word) => word.start >= start - 8 && word.start < firstVerse,
  )
  const isNumber = (word?: { text: string }) =>
    !!word && /^\d+$/.test(normalize(word.text))
  for (let i = heading.length - 2; i > 0; i--) {
    const [name, number, next] = heading.slice(i - 1, i + 2)
    if (
      normalize(number.text) !== String(chapter) ||
      isNumber(name) ||
      !isNumber(next)
    ) {
      continue
    }
    const round = (seconds: number) => Math.round(seconds * 100) / 100
    // A numbered book's name begins with its number: «2 Reis».
    const before = heading[i - 2]
    const first =
      before && /^[123]$/.test(normalize(before.text)) ? before : name
    // A word's time marks a moment into it: a breath before each.
    return {
      start: round(first.start - 0.35),
      end: round(Math.max(number.start + 0.3, next.start - 0.15)),
    }
  }
  return undefined
}
