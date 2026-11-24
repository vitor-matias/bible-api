// Builds data/mais365.json: for each chapter, the +365 episodes that read it
// and where the reading starts. Runs locally (it needs ffmpeg and whisper-cli)
// and re-runs cheaply, as transcripts are cached in .cache/mais365:
//   npx tsc && node dist/scripts/mais365.js [--days 1-181 | --days 3,19]
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  alignVerses,
  type TimedWord,
  type VerseText,
} from "../services/audio/alignVerses"
import {
  type BookName,
  findChapterEnd,
  findChapterStarts,
  parseReadings,
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
const DESCRIPTION_FIXES: Record<number, [string, string][]> = {
  // Solomon's wealth, read with 1 Reis 6: 2 Crónicas 9 (the "2" is missing).
  148: [["; Crónicas 9", "; 2 Crónicas 9"]],
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
): Promise<TimedWord[]> => {
  const { transcription } = JSON.parse(
    await whisper(guid, url, ".words.json", [
      "-nfa",
      "-dtw",
      "large.v3.turbo",
      "-ojf",
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

/** One reading of a day: where it starts and ends, and its verses' times. */
const timeReading = async (
  episode: Episode,
  reading: Reading,
  start: number | undefined,
  nextStart: number | undefined,
  transcript: { segments: Segment[]; words: TimedWord[] },
  run: Run,
): Promise<PlanDay["readings"][number]> => {
  const { day, title, url } = episode
  const { bookId, chapter, verses: range } = reading
  const report = (problem: string) =>
    run.problems.push(`Dia ${day}: ${problem}`)
  if (start === undefined) report(`no heading for ${bookId} ${chapter}`)
  // Read in part (Provérbios 1:1-7): those verses only.
  const verses = (await chapterVerses(bookId, chapter)).filter(
    (verse) => !range || (verse.number >= range[0] && verse.number <= range[1]),
  )
  const end =
    start === undefined
      ? undefined
      : findChapterEnd(
          transcript.segments,
          start,
          nextStart,
          verses.at(-1)?.text ?? "",
        )
  if (start !== undefined && end === undefined)
    report(`no end for ${bookId} ${chapter}`)
  const aligned =
    start !== undefined && end !== undefined
      ? alignVerses(transcript.words, verses, start, end)
      : null
  const total = verses.filter((verse) => verse.number > 0).length
  if (!aligned) report(`${bookId} ${chapter} not aligned`)
  else if (aligned.anchored < total * 0.6)
    report(`${bookId} ${chapter} ${aligned.anchored}/${total} anchored`)
  const timing: Timing = {
    day,
    title,
    url,
    start: start ?? null,
    end: end ?? null,
    ...(range && { range }),
    ...(aligned && { verses: aligned.times }),
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
  const transcript = {
    segments: await transcribe(guid, url),
    words: await transcribeWords(guid, url),
  }
  const starts = findChapterStarts(transcript.segments, readings, run.books)
  const planned: PlanDay["readings"] = []
  for (const [i, reading] of readings.entries()) {
    const nextStart = starts.slice(i + 1).find((s) => s !== undefined)
    planned.push(
      await timeReading(
        episode,
        reading,
        starts[i],
        nextStart,
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

const main = async () => {
  fs.mkdirSync(CACHE, { recursive: true })
  const books = (await (await fetch(`${API}/v1/books`)).json()) as BookName[]
  const feed = await (await fetch(FEED)).text()
  const run: Run = { books, chapters: {}, problems: [] }
  const days: PlanDay[] = []
  const items = feed
    .split("<item>")
    .slice(1)
    .map((item) => ({
      item,
      title: field(item, "title"),
      published: Date.parse(field(item, "pubDate")),
    }))
    .sort((a, b) => a.published - b.published)

  let lastDay = 0
  for (const { item, title } of items) {
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
      const message = error instanceof Error ? error.message : String(error)
      run.problems.push(`Dia ${episode.day}: failed, ${message}`)
    }
  }

  for (const entries of Object.values(run.chapters))
    entries.sort((a, b) => a.day - b.day)
  days.sort((a, b) => a.day - b.day)
  const { chapters, problems } = run
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, `${JSON.stringify({ source: FEED, chapters, days })}\n`)
  console.log(
    `${days.length} days, ${Object.keys(chapters).length} chapters written to ${OUT}`,
  )
  // What to check by ear: no run is clip-checked day by day.
  console.log(`\n${problems.length} to check:`)
  for (const problem of problems) console.log(`  ${problem}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
