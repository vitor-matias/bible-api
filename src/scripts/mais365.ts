// Builds data/mais365.json: for each chapter, the +365 episodes that read it
// and where the reading starts. Runs locally (it needs ffmpeg and whisper-cli)
// and re-runs cheaply, as transcripts are cached in .cache/mais365:
//   npx tsc && node dist/scripts/mais365.js [--days 1-181 | --days 3,19]
// Without --days it writes every day; with it, only those, keeping the rest.
import { execFileSync, spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  alignVerses,
  type TimedWord,
  type VerseText,
} from "../services/audio/alignVerses"
import { findTemplate } from "../services/audio/jingle"
import {
  type BookName,
  findChapterEnd,
  findChapterOpening,
  findChapterStarts,
  findReadingStart,
  findTitle,
  losesWords,
  mergePlan,
  parseReadings,
  pastHeadingPause,
  type Reading,
  type Segment,
} from "../services/audio/mais365"

const FEED = "https://anchor.fm/s/fbcf8b30/podcast/rss"
const API = process.env.API_ORIGIN ?? "https://biblia.capuchinhos.org"
const MODEL =
  process.env.WHISPER_MODEL ??
  path.join(os.homedir(), ".cache/whisper/ggml-large-v3-turbo-q5_0.bin")
// Absolute paths, not a PATH lookup (Homebrew's on Apple silicon by default).
const FFMPEG = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg"
const WHISPER = process.env.WHISPER_CLI ?? "/opt/homebrew/bin/whisper-cli"
const CACHE = path.resolve(".cache/mais365")
const OUT = path.resolve("data/mais365.json")

// "1-181", "3,19", or both: "1-5,19".
const daysArg = process.argv.indexOf("--days")
const onlyDays =
  daysArg > 0
    ? new Set(
        process.argv[daysArg + 1].split(",").flatMap((part) => {
          const [from, to = from] = part.split("-").map(Number)
          return Array.from({ length: to - from + 1 }, (_, i) => from + i)
        }),
      )
    : null

// Descriptions that name a reading wrongly, by day: [as written, as read].
// Dia 144–156 and 173 name the psalms of other days; the episodes read the
// official plan's (ejns.pt/mais365, "Plano de leitura oficial").
const DESCRIPTION_FIXES: Record<number, [string, string][]> = {
  144: [["Salmo 44", "Salmo 62"]],
  145: [["Salmo 45", "Salmo 64"]],
  146: [
    ["2 Crónicas 6-7", "2 Crónicas 6"],
    ["Salmo 46", "Salmo 65"],
  ],
  147: [
    ["2 Crónicas 8", "2 Crónicas 7-8"],
    ["Salmo 47", "Salmo 66"],
  ],
  // Solomon's wealth, read with 1 Reis 6: 2 Crónicas 9 (the "2" is missing).
  148: [
    ["; Crónicas 9", "; 2 Crónicas 9"],
    ["Salmo 48", "Salmo 4"],
  ],
  149: [["Salmo 49", "Salmo 5"]],
  150: [["Salmo 50", "Salmo 6"]],
  151: [["Salmo 51", "Salmo 7"]],
  152: [["Salmo 52", "Salmo 8"]],
  153: [["Salmo 53", "Salmo 9"]],
  155: [["Salmo 21", "Salmo 20"]],
  156: [["Salmo 22", "Salmo 21"]],
  173: [["Salmo 77", "Salmo 127"]],
}

/** "00:22:24", "22:24" or "1344": seconds. */
const seconds = (duration: string): number =>
  duration
    .split(":")
    .map(Number)
    .reduce((total, part) => total * 60 + part, 0)

/** "Padre Miguel Vasconcelos", or both of an introduction's. */
const priestsOf = (description: string): string | undefined => {
  const text = description.replace(/<[^<>]*>/g, " ")
  const names: string[] = []
  for (const match of text.matchAll(
    /\b(?:Padre|P\.)\s+((?:[A-ZÀ-Ý][A-Za-zÀ-ÿ]+\s?){2,3})/g,
  )) {
    const name = `Padre ${match[1].trim()}`
    if (!names.includes(name)) names.push(name)
  }
  return names.length ? names.join(" e o ") : undefined
}

// shortcut: regexes over Anchor's fixed RSS layout instead of an XML parser;
// switch to a parser if the feed ever changes host.
const field = (item: string, tag: string) =>
  new RegExp(
    String.raw`<${tag}[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?</${tag}>`,
  )
    .exec(item)?.[1]
    .trim() ?? ""

/**
 * The end-of-reading jingle's first 0.8 s, 8 kHz mono float (data/), cut
 * 0.1 s after it starts: from Dia 6, where it comes in under Provérbios 1,7.
 */
const JINGLE_RATE = 8000
const JINGLE_LEAD = 0.1
const jingle = (() => {
  const bytes = fs.readFileSync(path.resolve("data/mais365-jingle.f32"))
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
})()

/** The pauses (0.4 s or more) in the 6 s from `from`, [start, end] each. */
const pausesFrom = (
  guid: string,
  url: string,
  from: number,
): [number, number][] => {
  // ffmpeg logs what it detects on stderr.
  const log = spawnSync(
    FFMPEG,
    ["-v", "info", "-ss", String(from), "-t", "6"]
      .concat(["-i", cachedAudio(guid) ?? url])
      .concat(["-af", "silencedetect=n=-35dB:d=0.4", "-f", "null", "-"]),
    { encoding: "utf8" },
  ).stderr
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)]
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)]
  return ends.map((end, i) => [
    from + Number(starts[i]?.[1] ?? 0),
    from + Number(end[1]),
  ])
}

/** An episode's audio, if an earlier run kept it. */
const cachedAudio = (guid: string): string | undefined => {
  const file = path.join(CACHE, "audio", `${guid}.m4a`)
  return fs.existsSync(file) ? file : undefined
}

/**
 * Where the end-of-reading jingle starts near `around`, from 1 s before to
 * 2 s after: the jingle can come in under a reading's last word, so a part
 * ends just before it, not at its words' end. Undefined without a match as
 * clear as `least` (speech alone scores 0.3 at most; the jingle 0.44 to 0.48
 * where it starts on its own, before a heading).
 */
const jingleNear = async (
  guid: string,
  url: string,
  around: number,
  least = 0.6,
): Promise<number | undefined> => {
  const from = Math.max(0, around - 1)
  const length = 3 + jingle.length / JINGLE_RATE
  const pcm = execFileSync(
    FFMPEG,
    ["-v", "error", "-ss", String(from), "-t", String(length)]
      // Read from the stream unless kept: ffmpeg seeks in it.
      .concat(["-i", cachedAudio(guid) ?? url])
      .concat(["-f", "f32le", "-ac", "1", "-ar", String(JINGLE_RATE), "-"]),
    { maxBuffer: 1 << 26 },
  )
  const signal = new Float32Array(
    pcm.buffer,
    pcm.byteOffset,
    pcm.byteLength / 4,
  )
  const { index, score } = findTemplate(signal, jingle)
  return score < least ? undefined : from + index / JINGLE_RATE - JINGLE_LEAD
}

/**
 * Runs whisper-cli on an episode once, caching its JSON as <guid><suffix>:
 * the audio is downloaded, converted and deleted again around the run.
 */
const whisper = async (
  guid: string,
  url: string,
  suffix: string,
  options: string[],
): Promise<string> => {
  const json = path.join(CACHE, `${guid}${suffix}`)
  if (!fs.existsSync(json)) {
    const audio = path.join(CACHE, `${guid}.m4a`)
    const wav = path.join(CACHE, `${guid}.wav`)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
    fs.writeFileSync(audio, Buffer.from(await response.arrayBuffer()))
    execFileSync(FFMPEG, [
      "-v",
      "error",
      "-y",
      "-i",
      audio,
      "-ar",
      "16000",
      "-ac",
      "1",
      wav,
    ])
    execFileSync(
      WHISPER,
      [
        "-m",
        MODEL,
        "-l",
        "pt",
        "-np",
        ...options,
        "-of",
        json.slice(0, -5),
        "-f",
        wav,
      ],
      { stdio: "ignore" },
    )
    fs.rmSync(audio)
    fs.rmSync(wav)
  }
  return fs.readFileSync(json, "utf8")
}

type WhisperSegment = {
  offsets: { from: number; to: number }
  text: string
  tokens?: { text: string; offsets: { from: number }; t_dtw: number }[]
}

/** Sentence-long segments: where each chapter's spoken heading is. */
const transcribe = async (guid: string, url: string): Promise<Segment[]> => {
  const { transcription } = JSON.parse(
    await whisper(guid, url, ".json", ["-oj"]),
  ) as { transcription: WhisperSegment[] }
  return transcription.map((s) => ({
    start: s.offsets.from / 1000,
    end: s.offsets.to / 1000,
    text: s.text,
  }))
}

/**
 * Every word and when it was said, from token-level (DTW) timestamps, in a
 * cache of its own: the segments above, whose chapter starts and ends were
 * checked against the audio, stay as they are. DTW needs flash attention
 * off; without it whisper leaves every t_dtw at -1, which fails the run.
 */
const transcribeWords = async (
  guid: string,
  url: string,
  // Without the text before as a prompt (-mc 0): a pass that fell into a
  // loop ("Deus abençoar o teu servo." a hundred times) is run again so.
  fresh = false,
): Promise<TimedWord[]> => {
  const { transcription } = JSON.parse(
    await whisper(guid, url, fresh ? ".words-fresh.json" : ".words.json", [
      "-nfa",
      "-dtw",
      "large.v3.turbo",
      "-ojf",
      ...(fresh ? ["-mc", "0"] : []),
    ]),
  ) as { transcription: WhisperSegment[] }
  const tokens = transcription
    .flatMap((s) => s.tokens ?? [])
    .filter((t) => !t.text.startsWith("[_"))
  if (tokens.filter((t) => t.t_dtw >= 0).length < tokens.length / 2) {
    throw new Error(`${guid}: whisper gave no DTW timestamps`)
  }
  // Sub-word tokens join the word before; a leading space starts a new one.
  const words: TimedWord[] = []
  for (const token of tokens) {
    const start =
      token.t_dtw >= 0 ? token.t_dtw / 100 : token.offsets.from / 1000
    if (token.text.startsWith(" ") || words.length === 0) {
      words.push({ start, text: token.text })
    } else {
      const last = words.at(-1)
      if (last) last.text += token.text
    }
  }
  return words
}

type ApiVerse = { number: number; text: { type: string; text: string }[] }

/**
 * A chapter's verses as the app shows them: number and plain text. Cached on
 * disk, and retried: an answer refused (rate limit, a blip) would otherwise
 * leave a chapter unaligned without a word.
 */
const chapterVerses = async (
  bookId: string,
  chapter: number,
): Promise<VerseText[]> => {
  const file = path.join(CACHE, "verses", `${bookId}-${chapter}.json`)
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"))
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${API}/v1/${bookId}/${chapter}`)
    if (response.ok) {
      const { verses } = (await response.json()) as { verses: ApiVerse[] }
      const texts = verses.map((verse) => ({
        number: verse.number,
        text: verse.text
          .filter((t) => ["text", "quote", "paragraph"].includes(t.type))
          .map((t) => t.text)
          .join(" "),
      }))
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, JSON.stringify(texts))
      return texts
    }
    if (attempt === 4) {
      throw new Error(`${bookId} ${chapter}: HTTP ${response.status}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
  }
}

type Timing = {
  day: number
  title: string
  url: string
  start: number | null
  end: number | null
  /** [first, last] verse, when only part of the chapter is read. */
  range?: [number, number]
  /** Then, where the heading's chapter name starts and ends (before "1 a 4"). */
  titleStart?: number
  titleEnd?: number
  verses?: [number, number][]
}

/** A day of the plan as the app plays it; an introduction has no readings. */
type PlanDay = {
  day: number
  title: string
  theme: string
  priest?: string
  url: string
  duration: number
  readings: {
    bookId: string
    bookName: string
    chapter: number
    range?: [number, number]
    episode: Timing
  }[]
  /** Where the reflection starts (all of an introduction is). */
  reflection: number
}

/** What one episode is, to time a day of it. */
type Episode = {
  item: string
  day: number
  title: string
  theme: string
  priest?: string
  url: string
  duration: number
  description: string
}

/** Where the day's whole run is gathered: its chapters, and what to check. */
type Run = {
  books: BookName[]
  chapters: Record<string, Timing[]>
  problems: string[]
}

const bookNameOf = (bookId: string, books: BookName[]) =>
  bookId === "psa"
    ? "Salmo"
    : (books.find((b) => b.id === bookId)?.shortName ?? bookId)

type Transcript = {
  segments: Segment[]
  words: TimedWord[]
  freshWords: () => Promise<TimedWord[]>
  jingleNear: (around: number, least?: number) => Promise<number | undefined>
  pausesFrom: (from: number) => [number, number][]
}

/**
 * The end-of-reading jingle's length, from its onset to just before the next
 * heading: 4.6 s from Dia 2 (Génesis 4) and Dia 68 (Números 20), less a breath.
 */
const JINGLE_LENGTH = 4.3

/**
 * Where a reading starts, past the jingle before it: a start found from the
 * text (the heading unheard, or the reading before ending early) can fall on
 * it, and the chapter played from there opened with the music.
 */
const pastJingle = async (
  transcript: Transcript,
  start: number,
): Promise<number> => {
  const onset = await transcript.jingleNear(start, 0.4)
  return onset !== undefined && onset < start + 1.5
    ? Math.round((onset + JINGLE_LENGTH) * 100) / 100
    : start
}

/** Where a reading ends: in part, just before the jingle that follows it. */
const readingEnd = async (
  transcript: Transcript,
  start: number,
  nextStart: number | undefined,
  verses: VerseText[],
  nextFollows: boolean,
  range: [number, number] | undefined,
  report: (problem: string) => void,
): Promise<number | undefined> => {
  const end = findChapterEnd(
    transcript.segments,
    start,
    nextStart,
    verses.at(-1)?.text ?? "",
    nextFollows,
  )
  // Read in part, heard on into the next part: up to the jingle, not into it.
  if (!range || end === undefined) return end
  const onset = await transcript.jingleNear(end)
  if (onset === undefined) {
    report("no jingle after it")
    return end
  }
  return Math.round((onset - 0.1) * 100) / 100
}

/** Its verses' times, from a fresh pass of Whisper if the first lost words. */
const alignReading = async (
  transcript: Transcript,
  verses: VerseText[],
  start: number,
  end: number,
  chapter: number,
  heard: number,
  report: (problem: string) => void,
) => {
  // The heading's segment starts where it was heard, maybe on the jingle.
  const readFrom = Math.max(
    start,
    findReadingStart(transcript.segments, heard, chapter),
  )
  const align = (words: TimedWord[]) =>
    alignVerses(words, verses, start, end, readFrom)
  const first = align(transcript.words)
  // Words lost to a loop in Whisper's pass, or dropped from a stretch (Marcos
  // 1:1-3, the one word kept from it timed 4.5 s early): from a fresh one,
  // if it lines up more verses.
  if (first && !losesWords(transcript.segments, start, end)) return first
  // Without a first alignment its failure is the day's; with one, a note.
  const words = first
    ? await transcript.freshWords().catch((error: unknown) => {
        report(`fresh pass failed, ${String(error)}`)
        return undefined
      })
    : await transcript.freshWords()
  const fresh = words && align(words)
  return fresh && fresh.anchored > (first?.anchored ?? -1) ? fresh : first
}

/** One reading of a day: where it starts and ends, and its verses' times. */
const timeReading = async (
  episode: Episode,
  reading: Reading,
  heard: number | undefined,
  nextStart: number | undefined,
  nextFollows: boolean,
  transcript: Transcript,
  run: Run,
): Promise<PlanDay["readings"][number]> => {
  const { day, title, url } = episode
  const { bookId, chapter, verses: range } = reading
  const report = (problem: string) =>
    run.problems.push(`Dia ${day}: ${bookId} ${chapter}: ${problem}`)
  if (heard === undefined) report("no heading")
  // Read in part (Provérbios 1:1-7): those verses only.
  const verses = (await chapterVerses(bookId, chapter)).filter(
    (verse) => !range || (verse.number >= range[0] && verse.number <= range[1]),
  )
  const end =
    heard === undefined
      ? undefined
      : await readingEnd(
          transcript,
          heard,
          nextStart,
          verses,
          nextFollows,
          range,
          report,
        )
  if (heard !== undefined && end === undefined) report("no end")
  const start =
    heard === undefined ? undefined : await pastJingle(transcript, heard)
  const aligned =
    start !== undefined && end !== undefined
      ? await alignReading(
          transcript,
          verses,
          start,
          end,
          chapter,
          heard ?? start,
          report,
        )
      : null
  const total = verses.filter((verse) => verse.number > 0).length
  if (!aligned) report("not aligned")
  else if (aligned.anchored < total * 0.6)
    report(`${aligned.anchored}/${total} anchored`)
  const firstVerse = aligned?.times[0]?.[1]
  const named =
    range && start !== undefined && firstVerse !== undefined
      ? findTitle(transcript.words, start, firstVerse, chapter)
      : undefined
  // Where the chapter is named: its heading, or a part's title.
  const heading = named?.start ?? start ?? 0
  const timing: Timing = {
    day,
    title,
    url,
    start: start ?? null,
    end: end ?? null,
    ...(range && { range }),
    ...(named && { titleStart: named.start, titleEnd: named.end }),
    ...(aligned && {
      verses: pastHeadingPause(
        aligned.times,
        heading,
        transcript.pausesFrom(heading),
      ),
    }),
  }
  const key = `${bookId}/${chapter}`
  run.chapters[key] ??= []
  run.chapters[key].push(timing)
  return {
    bookId,
    bookName: bookNameOf(bookId, run.books),
    chapter,
    ...(range && { range }),
    episode: timing,
  }
}

/** The start of the last reading placed before the i-th, or 0. */
const lastStartBefore = (starts: (number | undefined)[], i: number): number => {
  for (let j = i - 1; j >= 0; j--) {
    const start = starts[j]
    if (start !== undefined) return start
  }
  return 0
}

/**
 * Chapters read without a heading (straight on from the one before): where
 * their first verse is said, between the readings around them.
 */
const placeUnheaded = async (
  day: number,
  readings: Reading[],
  starts: (number | undefined)[],
  segments: Segment[],
  run: Run,
): Promise<void> => {
  for (const [i, reading] of readings.entries()) {
    // The first may be placed after the announcement's sentence, which can
    // end after the reading began: its opening words, if said sooner.
    if (starts[i] !== undefined && i > 0) continue
    const from = lastStartBefore(starts, i)
    const to = starts.slice(i + 1).find((s) => s !== undefined)
    const opening = (await chapterVerses(reading.bookId, reading.chapter)).find(
      (verse) =>
        verse.number > 0 &&
        (!reading.verses || verse.number >= reading.verses[0]),
    )
    const found = findChapterOpening(segments, from, to, opening?.text ?? "")
    const before = starts[i]
    if (found === undefined || (before !== undefined && before <= found))
      continue
    starts[i] = found
    if (before === undefined)
      run.problems.push(
        `Dia ${day}: ${reading.bookId} ${reading.chapter} from its first verse`,
      )
  }
}

/** A day of the plan: its readings timed in its episode, then its reflection. */
const timeDay = async (
  episode: Episode,
  run: Run,
): Promise<PlanDay | undefined> => {
  const { item, day, theme, priest, url, duration } = episode
  let description = episode.description
  for (const [wrong, right] of DESCRIPTION_FIXES[day] ?? [])
    description = description.replace(wrong, right)
  const { readings, unparsed } = parseReadings(description, run.books)
  if (unparsed.length)
    run.problems.push(`Dia ${day}: unparsed ${JSON.stringify(unparsed)}`)
  if (!readings.length) {
    run.problems.push(`Dia ${day}: no readings`)
    return undefined
  }
  const guid = field(item, "guid")
  let fresh: Promise<TimedWord[]> | undefined
  const transcript = {
    segments: await transcribe(guid, url),
    words: await transcribeWords(guid, url),
    freshWords: () => {
      fresh ??= transcribeWords(guid, url, true)
      return fresh
    },
    jingleNear: (around: number, least?: number) =>
      jingleNear(guid, url, around, least),
    pausesFrom: (from: number) => pausesFrom(guid, url, from),
  }
  const starts = findChapterStarts(transcript.segments, readings, run.books)
  await placeUnheaded(day, readings, starts, transcript.segments, run)

  const planned: PlanDay["readings"] = []
  for (const [i, reading] of readings.entries()) {
    const nextStart = starts.slice(i + 1).find((s) => s !== undefined)
    // No heading (read straight on from the chapter before): where that one
    // ended.
    const start = starts[i] ?? planned.at(-1)?.episode.end ?? undefined
    if (starts[i] === undefined && start !== undefined)
      run.problems.push(
        `Dia ${day}: ${reading.bookId} ${reading.chapter} from the end before`,
      )
    planned.push(
      await timeReading(
        episode,
        reading,
        start,
        nextStart,
        i + 1 >= readings.length || starts[i + 1] !== undefined,
        transcript,
        run,
      ),
    )
  }
  const lastEnd = planned.at(-1)?.episode.end
  if (lastEnd == null) run.problems.push(`Dia ${day}: no reflection start`)
  console.log(`Dia ${day}: ${readings.length} readings`)
  return {
    day,
    title: theme,
    theme,
    priest,
    url,
    duration,
    readings: planned,
    reflection: lastEnd ?? duration,
  }
}

/** An item of the feed, as far as its RSS fields go. */
const episodeOf = (item: string, title: string): Episode => {
  const description = field(item, "description")
  return {
    item,
    day: Number(/^\s*Dia (\d+)/.exec(title)?.[1]),
    title,
    theme: title.replace(/^\s*Dia \d+\s*[-–]\s*/, ""),
    priest: priestsOf(description),
    url: /<enclosure url="([^"]+)"/.exec(item)?.[1] ?? "",
    duration: seconds(field(item, "itunes:duration")),
    description,
  }
}

/**
 * An introduction, placed after the day it came out with (Dia 0 before
 * Dia 1); undefined for any other special, or one outside --days.
 */
const introductionAfter = (
  lastDay: number,
  { title, priest, url, duration }: Episode,
): PlanDay | undefined => {
  const at = lastDay === 0 ? 0 : lastDay + 0.5
  const inRange = !onlyDays || onlyDays.has(Math.max(1, Math.ceil(at)))
  if (!title.startsWith("Introdução") || !inRange) return undefined
  return {
    day: at,
    title,
    theme: title,
    priest,
    url,
    duration,
    readings: [],
    reflection: 0,
  }
}

/** The feed's items, oldest first: an introduction falls after its day. */
const feedItems = (feed: string) =>
  feed
    .split("<item>")
    .slice(1)
    .map((item) => ({
      item,
      title: field(item, "title"),
      published: Date.parse(field(item, "pubDate")),
    }))
    .sort((a, b) => a.published - b.published)

/** Writes the plan and the chapters' timings, and says what to check by ear. */
const writeOut = (ran: PlanDay[], run: Run) => {
  // A run over some days (--days 154) keeps the rest of the plan.
  const { chapters, days } =
    onlyDays && fs.existsSync(OUT)
      ? mergePlan(JSON.parse(fs.readFileSync(OUT, "utf8")), {
          chapters: run.chapters,
          days: ran,
        })
      : { chapters: run.chapters, days: ran }
  const { problems } = run
  for (const entries of Object.values(chapters))
    entries.sort((a, b) => a.day - b.day)
  days.sort((a, b) => a.day - b.day)
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, `${JSON.stringify({ source: FEED, chapters, days })}\n`)
  console.log(
    `${days.length} days, ${Object.keys(chapters).length} chapters written to ${OUT}`,
  )
  // No run is clip-checked day by day.
  console.log(`\n${problems.length} to check:`)
  for (const problem of problems) console.log(`  ${problem}`)
}

const main = async () => {
  fs.mkdirSync(CACHE, { recursive: true })
  const books = (await (await fetch(`${API}/v1/books`)).json()) as BookName[]
  const feed = await (await fetch(FEED)).text()
  const run: Run = { books, chapters: {}, problems: [] }
  const days: PlanDay[] = []

  let lastDay = 0
  for (const { item, title } of feedItems(feed)) {
    const episode = episodeOf(item, title)
    if (!episode.day) {
      const intro = introductionAfter(lastDay, episode)
      if (intro) days.push(intro)
      continue
    }
    lastDay = episode.day
    if (onlyDays && !onlyDays.has(episode.day)) continue
    try {
      const day = await timeDay(episode, run)
      if (day) days.push(day)
    } catch (error) {
      run.problems.push(`Dia ${episode.day}: failed, ${String(error)}`)
    }
  }
  writeOut(days, run)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
