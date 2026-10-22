import type { createClient } from "redis"
import { mGetJson } from "../../util/jsonStore"
import { toQueryVector } from "../../util/vectorBuffer"
import { generateQueryEmbedding } from "../voyage/embeddings"
import { getVectorIndex, nearest, type VectorIndex } from "./searchIndex"

// The search returns at most this many results; results beyond this offset are
// unavailable.
export const KNN_MAX_RESULTS = 100

// Contextual embeddings give neighbouring verses similar vectors, so one
// passage could fill a page and push out the same saying elsewhere (a parallel
// Gospel, a quoted Law). At most this many verses per chapter are kept, in
// rank order.
export const MAX_VERSES_PER_CHAPTER = 2

// Neighbours ranked before the chapter cap thins them. Narrative queries
// cluster in a few chapters (300 candidates left as few as 29 results), while
// 1,000 kept the full KNN_MAX_RESULTS window for every query tested.
const KNN_CANDIDATES = KNN_MAX_RESULTS * 10

// Keeps verse keys in order, dropping any beyond `perChapter` from a chapter
// already represented. A verse key is "verse:<book>:<chapter>:<verse>".
export const capPerChapter = (
  verseKeys: string[],
  perChapter = MAX_VERSES_PER_CHAPTER,
): string[] => {
  const kept = new Map<string, number>()
  return verseKeys.filter((key) => {
    const chapter = key.slice(0, key.lastIndexOf(":"))
    const count = (kept.get(chapter) ?? 0) + 1
    kept.set(chapter, count)
    return count <= perChapter
  })
}

// `index` is what to rank over: the one loaded at startup unless a caller
// brings its own.
export const semanticSearchVerses = async (
  client: ReturnType<typeof createClient>,
  search: string,
  page: number,
  pageSize: number,
  index?: Pick<VectorIndex, "keys" | "matrix" | "dimensions">,
): Promise<VersePage> => {
  const offset = (page - 1) * pageSize

  // Defensive: the controller rejects out-of-window pages with a 400 so this
  // ambiguous zeroed page is unreachable over HTTP, but a direct caller should
  // still not pay for an embedding it cannot use.
  if (offset >= KNN_MAX_RESULTS) {
    return {
      verses: [],
      total: 0,
      currentPage: page,
      totalPages: 0,
    }
  }

  const queryVector = toQueryVector(await generateQueryEmbedding(search))

  // Always rank the full window: sizing it to the requested page would make
  // `total` (and therefore `totalPages`) shrink to that page and hide the rest
  // of the results. The cap is applied to all of it before paging, so pages
  // never overlap and `total` counts what can actually be paged through.
  const ranked = nearest(index ?? getVectorIndex(), queryVector, KNN_CANDIDATES)
  const rankedKeys = capPerChapter(ranked.map((result) => result.key)).slice(
    0,
    KNN_MAX_RESULTS,
  )

  if (rankedKeys.length === 0) {
    return {
      verses: [],
      total: 0,
      currentPage: page,
      totalPages: 0,
    }
  }

  const totalPages = Math.ceil(rankedKeys.length / pageSize)
  const pageKeys = rankedKeys.slice(offset, offset + pageSize)

  const verses: Verse[] = []
  for (const verse of await mGetJson<Verse>(client, pageKeys)) {
    if (verse) {
      verses.push(verse)
    }
  }

  return {
    verses,
    total: rankedKeys.length,
    currentPage: page,
    totalPages,
  }
}
