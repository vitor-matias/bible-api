import type { createClient } from "redis"
import {
  EMBEDDING_INDEX,
  EMBEDDING_KEY_PREFIX,
} from "../../util/embeddingIndex"
import { jsonMGet } from "../../util/jsonMGet"
import { toFloat32Buffer } from "../../util/vectorBuffer"
import { generateQueryEmbedding } from "../voyage/embeddings"

// KNN search is capped at this many results; results beyond this offset are unavailable.
export const KNN_MAX_RESULTS = 100

// Contextual embeddings give neighbouring verses similar vectors, so one
// passage could fill a page and push out the same saying elsewhere (a parallel
// Gospel, a quoted Law). At most this many verses per chapter are kept, in
// rank order.
export const MAX_VERSES_PER_CHAPTER = 2

// Neighbours fetched before the chapter cap thins them. Narrative queries
// cluster in a few chapters (300 candidates left as few as 29 results), while
// 1,000 kept the full KNN_MAX_RESULTS window for every query tested and costs
// a few milliseconds more than 100.
const KNN_CANDIDATES = KNN_MAX_RESULTS * 10

// Per-query timeout for the KNN search, well above what it takes in production
// (up to about a second), so it never ends early with partial results.
const KNN_TIMEOUT_MS = 10_000

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

export const semanticSearchVerses = async (
  client: ReturnType<typeof createClient>,
  search: string,
  page: number,
  pageSize: number,
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

  const queryEmbedding = await generateQueryEmbedding(search)
  const embeddingBuffer = toFloat32Buffer(queryEmbedding)

  // Always ask for the full window: a KNN query returns at most K documents, so
  // sizing K to the requested page would make `total` (and therefore
  // `totalPages`) shrink to that page and hide the rest of the results.
  const results = (await client.ft.searchNoContent(
    EMBEDDING_INDEX,
    `*=>[KNN ${KNN_CANDIDATES} @embedding $vec AS score]`,
    {
      PARAMS: {
        vec: embeddingBuffer,
      },
      LIMIT: {
        from: 0,
        size: KNN_CANDIDATES,
      },
      SORTBY: {
        BY: "score",
        DIRECTION: "ASC",
      },
      // RediSearch's default 500 ms timeout returns whatever it has found so
      // far, often nothing, with no error. A KNN over KNN_CANDIDATES regularly
      // takes longer than that in production, so it gets its own bound.
      TIMEOUT: KNN_TIMEOUT_MS,
      DIALECT: 2,
    },
  )) as unknown as { total: number; documents: string[] }

  if (!results || results.total === 0) {
    return {
      verses: [],
      total: 0,
      currentPage: page,
      totalPages: 0,
    }
  }

  // The cap is applied to the whole ranked window before paging, so pages
  // never overlap and `total` counts what can actually be paged through.
  const rankedKeys = capPerChapter(
    // Ids only (no field loads): embedding:<b>:<c>:<v> -> verse:<b>:<c>:<v>.
    results.documents.map(
      (id) => `verse:${id.slice(EMBEDDING_KEY_PREFIX.length)}`,
    ),
  ).slice(0, KNN_MAX_RESULTS)
  const totalResults = rankedKeys.length
  const totalPages = Math.ceil(totalResults / pageSize)

  const verseKeys = rankedKeys.slice(offset, offset + pageSize)

  // One round trip for the whole page.
  const verses = (await jsonMGet<Verse>(client, verseKeys)).filter(
    (verse): verse is Verse => verse != null,
  )

  return {
    verses,
    total: totalResults,
    currentPage: page,
    totalPages,
  }
}
