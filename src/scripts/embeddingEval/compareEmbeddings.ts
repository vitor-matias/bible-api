// Compares embedding models on the semantic search this API serves: every
// verse the import embeds is embedded with each candidate, and the queries in
// queries.ts are ranked against the whole corpus by cosine similarity, as the
// production index ranks them. The search here is exact rather than HNSW, so
// the comparison isolates the model.
//
// Needs Redis with the Bible imported (verse texts are read from it, exactly
// as the import embeds them) and OPENAI_API_KEY / GOOGLE_API_KEY in .env.
//
//   npx tsc && node dist/scripts/embeddingEval/compareEmbeddings.js
//     --only oai-small,gem-001   run only these candidates (labels below)
//     --top 5                    also list each candidate's top results
//
// Corpus vectors are cached under .cache/embedding-eval, so a rerun after
// editing the queries only pays for the queries. At 4 bytes per dimension for
// ~35k verses that is about 220 MB per 1536-dimension model and 440 MB per
// 3072-dimension one.

import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { createClient } from "redis"
import { DOCUMENT_PREFIX, QUERY_PREFIX } from "../../services/gemini/embeddings"
import {
  collectForEmbedding,
  type VerseForEmbedding,
} from "../../services/usfmImportService/storeChapter"
import { verseKey } from "../../services/verse/getVerse"
import { mapWithConcurrency } from "../../util/concurrency"
import { type Candidate, embed, type InputType, MAX_BATCH } from "./providers"
import { EVAL_QUERIES, refToKey } from "./queries"

require("dotenv").config()

const CANDIDATES: Candidate[] = [
  // What production used before gemini-embedding-2.
  {
    label: "oai-small",
    provider: "openai",
    model: "text-embedding-3-small",
    dimensions: 1536,
  },
  {
    label: "oai-large",
    provider: "openai",
    model: "text-embedding-3-large",
    dimensions: 3072,
    alsoEvaluateAt: [1536],
  },
  {
    label: "gem-001",
    provider: "gemini",
    model: "gemini-embedding-001",
    dimensions: 3072,
    alsoEvaluateAt: [1536],
    taskType: true,
  },
  // What production uses, at 1536. It takes the task as a text prefix
  // instead of a task type.
  {
    label: "gem-2",
    provider: "gemini",
    model: "gemini-embedding-2",
    dimensions: 3072,
    alsoEvaluateAt: [1536],
    queryPrefix: QUERY_PREFIX,
    documentPrefix: DOCUMENT_PREFIX,
  },
]

const CACHE_DIR = path.join(".cache", "embedding-eval")

// Verses per cache file. A run that dies part-way (a quota, a dropped
// connection) resumes from the last finished chunk.
const CHUNK_SIZE = 1024

const CONCURRENCY: Record<Candidate["provider"], number> = {
  openai: 4,
  gemini: 2,
}

type Corpus = {
  keys: string[]
  texts: string[]
  // Identifies the exact texts and order, so a cache built from another
  // import is never paired with this one.
  hash: string
  indexByKey: Map<string, number>
}

const loadCorpus = async (
  client: ReturnType<typeof createClient>,
): Promise<Corpus> => {
  // SCAN can return a key more than once.
  const keys = new Set<string>()
  for await (const batch of client.scanIterator({
    MATCH: "verse:*",
    COUNT: 1000,
  })) {
    for (const key of batch) keys.add(key)
  }

  // collectForEmbedding is the import's own rule for what enters the vector
  // index, so the corpus here is exactly the one production searches.
  const collected: VerseForEmbedding[] = []
  const allKeys = [...keys]
  for (let i = 0; i < allKeys.length; i += 1000) {
    const docs = await client.json.mGet(allKeys.slice(i, i + 1000), "$")
    for (const doc of docs) {
      const verse = (doc as unknown as Verse[] | null)?.[0]
      if (verse) collectForEmbedding(collected, verse, verse.number)
    }
  }

  if (collected.length === 0) {
    throw new Error("No verses found in Redis; run the import first")
  }

  // Canonical order keeps cache chunks aligned across runs.
  collected.sort((a, b) =>
    a.verseData.searchId < b.verseData.searchId ? -1 : 1,
  )

  const corpusKeys = collected.map(({ verseData }) =>
    verseKey(verseData.bookId, verseData.chapterNumber, verseData.number),
  )
  // generateEmbeddings sends trimmed text.
  const texts = collected.map(({ text }) => text.trim())

  const hash = createHash("sha256")
  corpusKeys.forEach((key, i) => {
    hash.update(`${key}\t${texts[i]}\n`)
  })

  return {
    keys: corpusKeys,
    texts,
    hash: hash.digest("hex"),
    indexByKey: new Map(corpusKeys.map((key, i) => [key, i])),
  }
}

const keyToRef = (key: string): string => {
  const [, book, chapter, verse] = key.split(":")
  return `${book.toUpperCase()} ${chapter}:${verse}`
}

// Resolves every expected verse before anything is embedded: a typo would
// otherwise score as a verse no model can find.
const resolveRelevant = (corpus: Corpus): number[][] => {
  const unknown: string[] = []
  const resolved = EVAL_QUERIES.map(({ query, relevant }) =>
    relevant.flatMap((ref) => {
      const index = corpus.indexByKey.get(refToKey(ref) ?? "")
      if (index === undefined) {
        unknown.push(`"${query}": ${ref}`)
        return []
      }
      return [index]
    }),
  )
  if (unknown.length > 0) {
    throw new Error(
      `Expected verses not found in the corpus:\n  ${unknown.join("\n  ")}`,
    )
  }
  return resolved
}

const embedInBatches = async (
  candidate: Candidate,
  texts: string[],
  type: InputType,
): Promise<number[][]> => {
  const vectors: number[][] = []
  for (let i = 0; i < texts.length; i += MAX_BATCH[candidate.provider]) {
    const batch = texts.slice(i, i + MAX_BATCH[candidate.provider])
    vectors.push(...(await embed(candidate, batch, type)))
  }
  return vectors
}

const readFloat32File = (file: string): Float32Array => {
  const bytes = fs.readFileSync(file)
  // Copied rather than viewed: a Buffer's offset need not be 4-byte aligned.
  const floats = new Float32Array(bytes.byteLength / 4)
  new Uint8Array(floats.buffer).set(bytes)
  return floats
}

// Returns the corpus vectors as one row-major array, embedding only the
// chunks the cache does not already hold.
const loadOrEmbedCorpus = async (
  candidate: Candidate,
  corpus: Corpus,
): Promise<Float32Array> => {
  const { dimensions } = candidate
  const dir = path.join(
    CACHE_DIR,
    `${candidate.model}-${dimensions}`.replace(/[^\w.-]/g, "_"),
  )
  // Everything that changes what a document embeds to. A mismatch means the
  // cached vectors belong to other texts or settings.
  const meta = JSON.stringify({
    provider: candidate.provider,
    model: candidate.model,
    dimensions,
    documentPrefix: candidate.documentPrefix,
    taskType: "taskType" in candidate ? candidate.taskType : undefined,
    corpus: corpus.hash,
  })
  const metaFile = path.join(dir, "meta.json")
  if (!fs.existsSync(metaFile) || fs.readFileSync(metaFile, "utf8") !== meta) {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(metaFile, meta)
  }

  const count = corpus.texts.length
  const vectors = new Float32Array(count * dimensions)
  const chunks = Array.from(
    { length: Math.ceil(count / CHUNK_SIZE) },
    (_, i) => i,
  )
  let finished = 0

  await mapWithConcurrency(
    chunks,
    CONCURRENCY[candidate.provider],
    async (chunk) => {
      const start = chunk * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, count)
      const file = path.join(dir, `${chunk}.f32`)

      if (
        fs.existsSync(file) &&
        fs.statSync(file).size === (end - start) * dimensions * 4
      ) {
        vectors.set(readFloat32File(file), start * dimensions)
      } else {
        const embedded = await embedInBatches(
          candidate,
          corpus.texts.slice(start, end),
          "document",
        )
        const part = new Float32Array((end - start) * dimensions)
        embedded.forEach((vector, i) => {
          part.set(vector, i * dimensions)
        })
        // Renamed into place, so an interrupted write never passes for a
        // finished chunk.
        fs.writeFileSync(`${file}.tmp`, new Uint8Array(part.buffer))
        fs.renameSync(`${file}.tmp`, file)
        vectors.set(part, start * dimensions)
      }

      finished++
      process.stdout.write(
        `\r  corpus: ${finished}/${chunks.length} chunks of ${CHUNK_SIZE} verses`,
      )
    },
  )
  process.stdout.write("\n")
  return vectors
}

// Scales each row to unit length in place, so a dot product is the cosine
// similarity the production index (DISTANCE_METRIC COSINE) ranks by.
const normalizeRows = (vectors: Float32Array, dims: number): Float32Array => {
  for (let offset = 0; offset < vectors.length; offset += dims) {
    let sumOfSquares = 0
    for (let k = 0; k < dims; k++) sumOfSquares += vectors[offset + k] ** 2
    const scale = sumOfSquares > 0 ? 1 / Math.sqrt(sumOfSquares) : 0
    for (let k = 0; k < dims; k++) vectors[offset + k] *= scale
  }
  return vectors
}

// Keeps the first `dims` components of each row (the shorter embedding the
// model was trained to produce), renormalised.
const truncateRows = (
  vectors: Float32Array,
  fromDims: number,
  dims: number,
): Float32Array => {
  const rows = vectors.length / fromDims
  const out = new Float32Array(rows * dims)
  for (let r = 0; r < rows; r++) {
    out.set(vectors.subarray(r * fromDims, r * fromDims + dims), r * dims)
  }
  return normalizeRows(out, dims)
}

type QueryResult = {
  // 1-based position of each expected verse in the full ranking.
  ranks: number[]
  top: { index: number; score: number }[]
}

type VariantResult = {
  label: string
  queries: QueryResult[]
}

// Indices of the k highest scores, best first.
const topK = (scores: Float32Array, k: number): number[] => {
  const top: number[] = []
  for (let i = 0; i < scores.length; i++) {
    if (top.length === k && scores[i] <= scores[top[k - 1]]) continue
    let position = top.length
    while (position > 0 && scores[top[position - 1]] < scores[i]) position--
    top.splice(position, 0, i)
    if (top.length > k) top.pop()
  }
  return top
}

const evaluate = (
  label: string,
  vectors: Float32Array,
  dims: number,
  queryVectors: Float32Array,
  relevant: number[][],
  keep: number,
): VariantResult => {
  const rows = vectors.length / dims
  const queries = relevant.map((expected, q) => {
    const query = queryVectors.subarray(q * dims, (q + 1) * dims)
    const scores = new Float32Array(rows)
    for (let r = 0; r < rows; r++) {
      let dot = 0
      const offset = r * dims
      for (let k = 0; k < dims; k++) dot += vectors[offset + k] * query[k]
      scores[r] = dot
    }

    // Ties count against the expected verse.
    const ranks = expected.map((index) => {
      let rank = 1
      for (let r = 0; r < rows; r++) if (scores[r] > scores[index]) rank++
      return rank
    })
    const top = topK(scores, keep).map((index) => ({
      index,
      score: scores[index],
    }))
    return { ranks, top }
  })
  return { label, queries }
}

// Share of a query's expected verses within the first k, out of as many as
// could fit there.
const recallAt = (ranks: number[], k: number): number =>
  ranks.filter((rank) => rank <= k).length / Math.min(ranks.length, k)

const mean = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length

const pad = (value: string, width: number) => value.padStart(width)

const printReport = (
  results: VariantResult[],
  corpus: Corpus,
  showTop: number,
) => {
  const labelWidth = Math.max(...results.map((r) => r.label.length)) + 2

  console.log(
    `\nSummary (mean over ${EVAL_QUERIES.length} queries; R@k is the share of expected verses in the first k, MRR is 1/rank of the first one found)\n`,
  )
  console.log(
    `${"".padEnd(labelWidth)}${pad("R@10", 8)}${pad("R@100", 8)}${pad("MRR", 8)}`,
  )
  for (const { label, queries } of results) {
    const r10 = mean(queries.map((q) => recallAt(q.ranks, 10)))
    const r100 = mean(queries.map((q) => recallAt(q.ranks, 100)))
    const mrr = mean(queries.map((q) => 1 / Math.min(...q.ranks)))
    console.log(
      `${label.padEnd(labelWidth)}${pad(r10.toFixed(3), 8)}${pad(r100.toFixed(3), 8)}${pad(mrr.toFixed(3), 8)}`,
    )
  }

  console.log(
    "\nPer query: rank of each expected verse, and the similarity of the 1st and 10th results (for calibrating a minimum-similarity cut-off)",
  )
  EVAL_QUERIES.forEach(({ query, relevant }, q) => {
    const widths = relevant.map((ref) => Math.max(ref.length, 6) + 2)
    console.log(`\n"${query}"`)
    console.log(
      `${"".padEnd(labelWidth)}${relevant.map((ref, i) => pad(ref, widths[i])).join("")}${pad("sim#1", 8)}${pad("sim#10", 8)}`,
    )
    for (const { label, queries } of results) {
      const { ranks, top } = queries[q]
      console.log(
        `${label.padEnd(labelWidth)}${ranks.map((rank, i) => pad(String(rank), widths[i])).join("")}${pad(top[0].score.toFixed(3), 8)}${pad(top[9].score.toFixed(3), 8)}`,
      )
    }
    if (showTop > 0) {
      for (const { label, queries } of results) {
        console.log(`  ${label}`)
        queries[q].top.slice(0, showTop).forEach(({ index, score }, i) => {
          const ref = keyToRef(corpus.keys[index])
          const text = corpus.texts[index].slice(0, 90)
          console.log(
            `    ${pad(String(i + 1), 2)}. ${ref.padEnd(10)} ${score.toFixed(3)}  ${text}`,
          )
        })
      }
    }
  })
}

const option = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

const main = async () => {
  const args = process.argv.slice(2)
  const only = option(args, "--only")?.split(",")
  const showTop = Number(option(args, "--top") ?? 0)

  if (!Number.isInteger(showTop) || showTop < 0) {
    throw new Error("--top must be a non-negative integer")
  }
  const unknownLabels = only?.filter(
    (label) => !CANDIDATES.some((c) => c.label === label),
  )
  if (unknownLabels?.length) {
    throw new Error(
      `Unknown candidate(s): ${unknownLabels.join(", ")}. Available: ${CANDIDATES.map((c) => c.label).join(", ")}`,
    )
  }
  const candidates = only
    ? CANDIDATES.filter((c) => only.includes(c.label))
    : CANDIDATES

  // Without this, a stopped Redis makes connect() retry forever.
  const client = createClient({
    url: process.env.DB_URL,
    socket: { reconnectStrategy: false },
  })
  // A failed connection or command already rejects its own promise; the
  // listener only keeps the event from crashing the process.
  client.on("error", () => {})
  try {
    await client.connect()
  } catch (error) {
    throw new Error(
      `Cannot reach Redis at ${process.env.DB_URL}; start it and import the Bible first (${error})`,
    )
  }
  let corpus: Corpus
  try {
    corpus = await loadCorpus(client)
  } finally {
    await client.quit()
  }

  const relevant = resolveRelevant(corpus)
  console.log(
    `${corpus.texts.length} verses, ${EVAL_QUERIES.length} queries, ${candidates.length} candidate(s)`,
  )

  // At least 10 so sim#10 always exists.
  const keep = Math.max(10, showTop)
  const results: VariantResult[] = []
  const failures: string[] = []

  for (const candidate of candidates) {
    console.log(`\n${candidate.label} (${candidate.model})`)
    try {
      const corpusVectors = normalizeRows(
        await loadOrEmbedCorpus(candidate, corpus),
        candidate.dimensions,
      )
      const queryVectors = normalizeRows(
        Float32Array.from(
          (
            await embedInBatches(
              candidate,
              EVAL_QUERIES.map(({ query }) => query),
              "query",
            )
          ).flat(),
        ),
        candidate.dimensions,
      )

      for (const dims of [
        candidate.dimensions,
        ...(candidate.alsoEvaluateAt ?? []),
      ]) {
        const full = dims === candidate.dimensions
        results.push(
          evaluate(
            `${candidate.label}@${dims}`,
            full
              ? corpusVectors
              : truncateRows(corpusVectors, candidate.dimensions, dims),
            dims,
            full
              ? queryVectors
              : truncateRows(queryVectors, candidate.dimensions, dims),
            relevant,
            keep,
          ),
        )
      }
    } catch (error) {
      // One provider's quota or key problem should not lose the others.
      console.error(
        `\n  failed: ${error instanceof Error ? error.message : error}`,
      )
      failures.push(candidate.label)
    }
  }

  if (results.length > 0) printReport(results, corpus, showTop)
  if (failures.length > 0) {
    console.error(`\nFailed: ${failures.join(", ")}`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
