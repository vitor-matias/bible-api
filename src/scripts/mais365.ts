// Builds data/mais365.json: for each chapter, the +365 episodes that read it
// and where the reading starts. Runs locally (it needs ffmpeg and whisper-cli)
// and re-runs cheaply, as transcripts are cached in .cache/mais365:
//   npx tsc && node dist/scripts/mais365.js [--days 3,19]
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

const daysArg = process.argv.indexOf("--days")
const onlyDays =
  daysArg > 0 ? new Set(process.argv[daysArg + 1].split(",").map(Number)) : null

// shortcut: regexes over Anchor's fixed RSS layout instead of an XML parser;
// switch to a parser if the feed ever changes host.
const field = (item: string, tag: string) =>
  new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`)
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
      words[words.length - 1].text += token.text
    }
  }
  return words
}

type ApiVerse = { number: number; text: { type: string; text: string }[] }

/** A chapter's verses as the app shows them: number and plain text. */
const chapterVerses = async (
  bookId: string,
  chapter: number,
): Promise<VerseText[]> => {
  const response = await fetch(`${API}/v1/${bookId}/${chapter}`)
  if (!response.ok) return []
  const { verses } = (await response.json()) as { verses: ApiVerse[] }
  return verses.map((verse) => ({
    number: verse.number,
    text: verse.text
      .filter((t) => ["text", "quote", "paragraph"].includes(t.type))
      .map((t) => t.text)
      .join(" "),
  }))
}

const main = async () => {
  fs.mkdirSync(CACHE, { recursive: true })
  const books = (await (await fetch(`${API}/v1/books`)).json()) as BookName[]
  const feed = await (await fetch(FEED)).text()

  type Entry = {
    day: number
    title: string
    url: string
    start: number | null
    end: number | null
    verses?: [number, number][]
  }
  const chapters: Record<string, Entry[]> = {}

  for (const item of feed.split("<item>").slice(1)) {
    const title = field(item, "title")
    const day = Number(/^Dia (\d+)/.exec(title)?.[1])
    if (!day || (onlyDays && !onlyDays.has(day))) continue
    const { readings, unparsed } = parseReadings(
      field(item, "description"),
      books,
    )
    if (unparsed.length)
      console.warn(`Dia ${day}: unparsed ${JSON.stringify(unparsed)}`)
    if (!readings.length) continue

    const url = /<enclosure url="([^"]+)"/.exec(item)?.[1] ?? ""
    const guid = field(item, "guid")
    const segments = await transcribe(guid, url)
    const words = await transcribeWords(guid, url)
    const starts = findChapterStarts(segments, readings, books)
    for (const [i, { bookId, chapter }] of readings.entries()) {
      const start = starts[i]
      if (start === undefined) {
        console.warn(`Dia ${day}: no heading for ${bookId} ${chapter}`)
      }
      const verses = await chapterVerses(bookId, chapter)
      const nextStart = starts.slice(i + 1).find((s) => s !== undefined)
      const end =
        start === undefined
          ? undefined
          : findChapterEnd(
              segments,
              start,
              nextStart,
              verses.at(-1)?.text ?? "",
            )
      if (start !== undefined && end === undefined) {
        console.warn(`Dia ${day}: no end for ${bookId} ${chapter}`)
      }
      // Verse by verse, only within a known start and end.
      const aligned =
        start !== undefined && end !== undefined
          ? alignVerses(words, verses, start, end)
          : null
      const total = verses.filter((verse) => verse.number > 0).length
      console.log(
        `Dia ${day}: ${bookId} ${chapter} verses ${aligned ? `${aligned.anchored}/${total} anchored` : "not aligned"}`,
      )
      const key = `${bookId}/${chapter}`
      chapters[key] ??= []
      chapters[key].push({
        day,
        title,
        url,
        start: start ?? null,
        end: end ?? null,
        ...(aligned && { verses: aligned.times }),
      })
    }
    console.log(`Dia ${day}: ${readings.length} chapters`)
  }

  for (const entries of Object.values(chapters))
    entries.sort((a, b) => a.day - b.day)
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(
    OUT,
    `${JSON.stringify({ source: FEED, chapters }, null, 1)}\n`,
  )
  console.log(`${Object.keys(chapters).length} chapters written to ${OUT}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
