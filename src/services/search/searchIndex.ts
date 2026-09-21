import type { createClient } from "redis"
import { RESP_TYPES } from "redis"
import { mGetJson } from "../../util/jsonStore"
import {
  decodeVectorInto,
  getEmbeddingDimensions,
} from "../../util/vectorBuffer"
import { EMBEDDING_KEY_PREFIX, verseKeyFromEmbeddingKey } from "./embeddingKey"

// Both searches run inside this process, over data loaded from the database at
// startup, so the database only needs plain key/value commands: no RediSearch,
// no RedisJSON. The verse text is a few MB and the vectors are a few dozen, so
// scanning all of it per query takes milliseconds.

type Client = ReturnType<typeof createClient>

const SCAN_COUNT = 1000
const BATCH_SIZE = 500

// The nodes of a verse that make up its running text. A divine name is its own
// node in the source ("ao " then "Senhor"), so a phrase has to be able to run
// from one such node into the next.
const RUNNING_TEXT_NODE_TYPES: ReadonlySet<string> = new Set([
  "text",
  "quote",
  "paragraph",
])

// A section heading or a cross-reference line is searchable, but it is not part
// of the sentence around it: a verse document carries the heading of the
// passage that FOLLOWS the verse, so a phrase must never join the two.
const HEADING_NODE_TYPES: ReadonlySet<string> = new Set([
  "section",
  "references",
])

// Marks the boundary between segments. It is not a letter or digit, so no query
// can contain it and no phrase can match across it.
const SEGMENT_BREAK = ""

// ---------------------------------------------------------------- full text --

export type TextEntry = {
  key: string
  searchId: string
  // Normalized (lowercase, accent-free) text of the verse, in stretches a phrase
  // may run through: the running text as one, each heading as its own.
  segments: string[]
}

export type TextIndex = {
  // Verse keys, in searchId order.
  keys: string[]
  // The words of each verse, single-spaced and padded at both ends, so a phrase
  // can be found as a substring that cannot start or end mid-word.
  haystacks: string[]
  // For each word, the verses that contain it, as ascending positions in `keys`.
  // A query only has to look at the verses holding its rarest word.
  postings: Map<string, Int32Array>
}

const WORDS = /[a-z0-9]+/g

// Expects normalized text (see normalizeText). Punctuation separates words and
// is dropped, so "Deus," and "deus" are the same token.
export const tokenize = (normalized: string): string[] =>
  normalized.match(WORDS) ?? []

const compareSearchIds = (a: TextEntry, b: TextEntry): number => {
  if (a.searchId < b.searchId) return -1
  return a.searchId > b.searchId ? 1 : 0
}

export const buildTextIndex = (entries: readonly TextEntry[]): TextIndex => {
  const sorted = [...entries].sort(compareSearchIds)

  const haystacks: string[] = []
  const lists = new Map<string, number[]>()

  sorted.forEach((entry, verse) => {
    const segments = entry.segments.map((segment) => tokenize(segment))

    haystacks.push(
      ` ${segments.map((words) => words.join(" ")).join(` ${SEGMENT_BREAK} `)} `,
    )

    // Verses are visited in order, so each list stays ascending; a verse is
    // listed once per word however often the word occurs in it.
    for (const word of new Set(segments.flat())) {
      const list = lists.get(word)
      if (list) list.push(verse)
      else lists.set(word, [verse])
    }
  })

  const postings = new Map<string, Int32Array>()
  for (const [word, list] of lists) postings.set(word, Int32Array.from(list))

  return { keys: sorted.map((entry) => entry.key), haystacks, postings }
}

// Verses containing the query as an exact phrase of whole words, in verse
// order. `offset` and `limit` select one page; `total` counts every match.
export const findPhrase = (
  index: TextIndex,
  normalizedQuery: string,
  offset: number,
  limit: number,
): { keys: string[]; total: number } => {
  const tokens = tokenize(normalizedQuery)

  if (tokens.length === 0) return { keys: [], total: 0 }

  // Every verse that matches contains all of the query's words, so it is enough
  // to look at the verses holding the rarest one.
  let candidates: Int32Array | undefined
  for (const token of new Set(tokens)) {
    const verses = index.postings.get(token)

    if (!verses) return { keys: [], total: 0 }
    if (!candidates || verses.length < candidates.length) candidates = verses
  }
  if (!candidates) return { keys: [], total: 0 }

  const keys: string[] = []

  // One word: containing it is the whole condition, so no text is examined.
  if (tokens.length === 1) {
    const end = Math.min(candidates.length, offset + limit)
    for (let i = offset; i < end; i++) keys.push(index.keys[candidates[i]])
    return { keys, total: candidates.length }
  }

  const needle = ` ${tokens.join(" ")} `
  let total = 0

  for (const verse of candidates) {
    if (index.haystacks[verse].includes(needle)) {
      if (total >= offset && keys.length < limit) keys.push(index.keys[verse])
      total++
    }
  }

  return { keys, total }
}

// ------------------------------------------------------------------ vectors --

export type VectorIndex = {
  // Verse keys, one per row of the matrix.
  keys: string[]
  // Unit-length vectors, row after row.
  matrix: Float32Array
  dimensions: number
  // Stored vectors that were unreadable (wrong size), left out of the index.
  skipped: number
}

// The `k` rows closest to the query, best first. Both sides are unit length, so
// the dot product is the cosine similarity (1 is identical, -1 is opposite).
export const nearest = (
  index: Pick<VectorIndex, "keys" | "matrix" | "dimensions">,
  query: Float32Array,
  k: number,
): { key: string; score: number }[] => {
  const { keys, matrix, dimensions } = index
  const topScores = new Float64Array(k).fill(Number.NEGATIVE_INFINITY)
  const topRows = new Int32Array(k).fill(-1)

  for (let row = 0, base = 0; row < keys.length; row++, base += dimensions) {
    let score = 0
    for (let d = 0; d < dimensions; d++) {
      score += query[d] * matrix[base + d]
    }

    // Insert into the sorted top list, only once the row beats the current k-th.
    if (score > topScores[k - 1]) {
      let position = k - 1
      while (position > 0 && topScores[position - 1] < score) {
        topScores[position] = topScores[position - 1]
        topRows[position] = topRows[position - 1]
        position--
      }
      topScores[position] = score
      topRows[position] = row
    }
  }

  const results: { key: string; score: number }[] = []
  for (let i = 0; i < k && topRows[i] >= 0; i++) {
    results.push({ key: keys[topRows[i]], score: topScores[i] })
  }
  return results
}

// ------------------------------------------------------------------ loading --

// SCAN can return a key more than once, so the keys are collected into a set.
const listKeys = async (client: Client, pattern: string): Promise<string[]> => {
  const keys = new Set<string>()

  for await (const batch of client.scanIterator({
    MATCH: pattern,
    COUNT: SCAN_COUNT,
  })) {
    for (const key of batch) keys.add(key)
  }

  return [...keys]
}

// Splits a verse into the stretches of text a phrase may run through. Footnotes
// carry no normalized text and are not searched.
export const toSegments = (verse: Pick<Verse, "text">): string[] => {
  const segments: string[] = []
  let running: string[] = []

  const endRunningText = () => {
    if (running.length > 0) {
      segments.push(running.join(" "))
      running = []
    }
  }

  for (const node of verse.text) {
    if (!("normalizedText" in node) || !node.normalizedText) continue

    if (RUNNING_TEXT_NODE_TYPES.has(node.type)) {
      running.push(node.normalizedText)
    } else if (HEADING_NODE_TYPES.has(node.type)) {
      endRunningText()
      segments.push(node.normalizedText)
    }
  }

  endRunningText()
  return segments
}

const loadTextEntries = async (client: Client): Promise<TextEntry[]> => {
  const keys = await listKeys(client, "verse:*")
  const entries: TextEntry[] = []

  // In batches, so the parsed documents (megabytes of JSON) never all sit in
  // memory at once; only the normalized text of each verse is kept.
  for (let start = 0; start < keys.length; start += BATCH_SIZE) {
    const batch = keys.slice(start, start + BATCH_SIZE)
    const verses = await mGetJson<Verse>(client, batch)

    verses.forEach((verse, position) => {
      // Verse 0 is the pseudo-verse holding chapter headings, not a verse.
      if (!verse || verse.number < 1) return

      entries.push({
        key: batch[position],
        searchId: verse.searchId,
        segments: toSegments(verse),
      })
    })
  }

  return entries
}

const loadVectorIndex = async (client: Client): Promise<VectorIndex> => {
  const dimensions = getEmbeddingDimensions()
  const storedKeys = await listKeys(client, `${EMBEDDING_KEY_PREFIX}*`)

  // Allocated once, at its final size: growing it batch by batch would briefly
  // hold two copies of what is the largest structure in the process.
  const matrix = new Float32Array(storedKeys.length * dimensions)
  const keys: string[] = []
  let skipped = 0

  // Vectors are binary, so they must be read as Buffers rather than as strings.
  const binary = client.withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer })

  for (let start = 0; start < storedKeys.length; start += BATCH_SIZE) {
    const batch = storedKeys.slice(start, start + BATCH_SIZE)
    const buffers = (await binary.mGet(batch)) as (Buffer | null)[]

    buffers.forEach((buffer, position) => {
      if (
        buffer === null ||
        !decodeVectorInto(buffer, matrix, keys.length * dimensions)
      ) {
        skipped++
        return
      }
      keys.push(verseKeyFromEmbeddingKey(batch[position]))
    })
  }

  return {
    keys,
    matrix: matrix.subarray(0, keys.length * dimensions),
    dimensions,
    skipped,
  }
}

let loaded: { text: TextIndex; vectors: VectorIndex } | null = null

export type SearchIndexStats = {
  verses: number
  vectors: number
  skippedVectors: number
}

// Replaces the index the searches use. Called at startup once the data is in
// the database; the old index keeps serving until the new one is complete.
export const loadSearchIndex = async (
  client: Client,
): Promise<SearchIndexStats> => {
  const text = buildTextIndex(await loadTextEntries(client))
  const vectors = await loadVectorIndex(client)

  loaded = { text, vectors }

  return {
    verses: text.keys.length,
    vectors: vectors.keys.length,
    skippedVectors: vectors.skipped,
  }
}

const requireLoaded = () => {
  if (!loaded) throw new Error("The search index has not been loaded yet")
  return loaded
}

export const getTextIndex = (): TextIndex => requireLoaded().text

export const getVectorIndex = (): VectorIndex => requireLoaded().vectors
