import { normalize } from "./mais365"

/** A word the reader said, and when (seconds into the episode). */
export type TimedWord = { start: number; text: string }
/** A verse as the app shows it: its number and plain text. */
export type VerseText = { number: number; text: string }

// About how long a read word lasts, to place a verse whose first words
// weren't matched from the first one that was.
const SECONDS_PER_WORD = 0.33
// Fewer verses than this anchored on what was said: the chapter's audio and
// text don't line up well enough to follow verse by verse.
const MIN_ANCHORED = 0.5

type Token = { verse: number; text: string }

const tokens = (text: string): string[] =>
  normalize(text).split(" ").filter(Boolean)

/**
 * The longest common subsequence of two word lists, as pairs of indices:
 * which spoken word each expected word was matched to, if any. Digits the
 * reader's transcript writes for spelled-out numbers simply go unmatched.
 */
const matchWords = (expected: string[], spoken: string[]): Int32Array => {
  const n = expected.length
  const m = spoken.length
  // Lengths of the LCS of expected[i..] and spoken[j..], a row at a time,
  // and the move taken at each cell (1 match, 2 skip expected, 3 skip spoken).
  const moves = new Uint8Array((n + 1) * (m + 1))
  let below = new Uint16Array(m + 1)
  for (let i = n - 1; i >= 0; i--) {
    const row = new Uint16Array(m + 1)
    for (let j = m - 1; j >= 0; j--) {
      if (expected[i] === spoken[j]) {
        row[j] = below[j + 1] + 1
        moves[i * (m + 1) + j] = 1
      } else if (below[j] >= row[j + 1]) {
        row[j] = below[j]
        moves[i * (m + 1) + j] = 2
      } else {
        row[j] = row[j + 1]
        moves[i * (m + 1) + j] = 3
      }
    }
    below = row
  }
  const matched = new Int32Array(n).fill(-1)
  let i = 0
  let j = 0
  while (i < n && j < m) {
    const move = moves[i * (m + 1) + j]
    if (move === 1) matched[i++] = j++
    else if (move === 2) i++
    else j++
  }
  return matched
}

/**
 * When each verse starts in the chapter's reading, [start, end] seconds into
 * the episode: the spoken words are lined up with the chapter's text, and a
 * verse starts where its first word in a run of two matches was said (less a
 * word's time for each word before it). Verses with no such run are placed
 * between their neighbours by word count (the first ones from `readFrom`).
 * Null when too few verses anchor to
 * follow the reading verse by verse.
 */
export const alignVerses = (
  words: TimedWord[],
  verses: VerseText[],
  start: number,
  end: number,
  // Where the reading's words begin, after its heading («Marcos 1»): verses
  // before the first one heard are placed from here, not from the heading.
  readFrom = start,
): { times: [number, number][]; anchored: number } | null => {
  const read = verses.filter((verse) => verse.number > 0)
  const expected: Token[] = read.flatMap((verse, index) =>
    tokens(verse.text).map((text) => ({ verse: index, text })),
  )
  const spokenWords = words
    .filter((word) => word.start >= start - 0.5 && word.start <= end)
    .flatMap((word) => tokens(word.text).map((text) => ({ ...word, text })))
  if (read.length === 0 || expected.length === 0) return null

  const matched = matchWords(
    expected.map((t) => t.text),
    spokenWords.map((w) => w.text),
  )

  // Each verse's first word, and the time its run of two first matches.
  // A verse with no words (left out of the text, as João 5:4) takes the
  // next one's place, and is placed between its neighbours.
  const firstWord = read.map((_, v) => {
    const index = expected.findIndex((t) => t.verse >= v)
    return index < 0 ? expected.length : index
  })
  const anchors: (number | undefined)[] = read.map((_, v) => {
    for (
      let i = firstWord[v];
      i < expected.length && expected[i].verse === v;
      i++
    ) {
      const j = matched[i]
      const next = matched[i + 1]
      if (j >= 0 && next === j + 1 && expected[i + 1]?.verse === v) {
        return spokenWords[j].start - (i - firstWord[v]) * SECONDS_PER_WORD
      }
    }
    return undefined
  })

  // A verse can't start before the one before it: such an anchor is a
  // stray match (a refrain, a repeated phrase), and is placed instead.
  let last = start
  for (let v = 0; v < anchors.length; v++) {
    const time = anchors[v]
    if (time === undefined) continue
    if (time < last || time > end) anchors[v] = undefined
    else last = time
  }
  const anchored = anchors.filter((time) => time !== undefined).length
  if (anchored < read.length * MIN_ANCHORED) return null

  const times = read.map((verse, v): [number, number] => {
    let time = anchors[v]
    if (time === undefined) {
      // Between the anchored verses around it, by how many words in it is.
      let before = v - 1
      while (before >= 0 && anchors[before] === undefined) before--
      let after = v + 1
      while (after < read.length && anchors[after] === undefined) after++
      const fromWord = before >= 0 ? firstWord[before] : 0
      const fromTime = before >= 0 ? (anchors[before] as number) : readFrom
      const toWord = after < read.length ? firstWord[after] : expected.length
      const toTime = after < read.length ? (anchors[after] as number) : end
      const share = (firstWord[v] - fromWord) / Math.max(1, toWord - fromWord)
      time = fromTime + share * (toTime - fromTime)
    }
    const within = Math.min(end, Math.max(start, time))
    return [verse.number, Math.round(within * 100) / 100]
  })
  return { times, anchored }
}
