// Builds data/mais365.json: for each chapter, the +365 episodes that read it
// and where the reading starts. Runs locally (it needs ffmpeg and whisper-cli)
// and re-runs cheaply, as transcripts are cached in .cache/mais365:
//   npx tsc && node dist/scripts/mais365.js [--days 3,19]
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
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

const transcribe = async (guid: string, url: string): Promise<Segment[]> => {
  const json = path.join(CACHE, `${guid}.json`)
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
        "-oj",
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
  const { transcription } = JSON.parse(fs.readFileSync(json, "utf8")) as {
    transcription: { offsets: { from: number; to: number }; text: string }[]
  }
  return transcription.map((s) => ({
    start: s.offsets.from / 1000,
    end: s.offsets.to / 1000,
    text: s.text,
  }))
}

type ApiVerse = { number: number; text: { type: string; text: string }[] }

/** The text of a chapter's last verse, as the app shows it. */
const lastVerse = async (bookId: string, chapter: number): Promise<string> => {
  const response = await fetch(`${API}/v1/${bookId}/${chapter}`)
  if (!response.ok) return ""
  const { verses } = (await response.json()) as { verses: ApiVerse[] }
  const last = verses.reduce((a, b) => (b.number > a.number ? b : a))
  return last.text
    .filter((t) => ["text", "quote", "paragraph"].includes(t.type))
    .map((t) => t.text)
    .join(" ")
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
    const segments = await transcribe(field(item, "guid"), url)
    const starts = findChapterStarts(segments, readings, books)
    for (const [i, { bookId, chapter }] of readings.entries()) {
      const start = starts[i]
      if (start === undefined) {
        console.warn(`Dia ${day}: no heading for ${bookId} ${chapter}`)
      }
      const nextStart = starts.slice(i + 1).find((s) => s !== undefined)
      const end =
        start === undefined
          ? undefined
          : findChapterEnd(
              segments,
              start,
              nextStart,
              await lastVerse(bookId, chapter),
            )
      if (start !== undefined && end === undefined) {
        console.warn(`Dia ${day}: no end for ${bookId} ${chapter}`)
      }
      const key = `${bookId}/${chapter}`
      chapters[key] ??= []
      chapters[key].push({
        day,
        title,
        url,
        start: start ?? null,
        end: end ?? null,
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
