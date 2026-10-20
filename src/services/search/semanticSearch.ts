import type { createClient, SearchReply } from "redis"
import { EMBEDDING_INDEX } from "../../util/embeddingIndex"
import { toFloat32Buffer } from "../../util/vectorBuffer"
import { generateQueryEmbeddings } from "../gemini/embeddings"
import { expandQuery } from "../gemini/expandQuery"

// The fields the query returns: the vector itself never leaves the index.
// `score` is the cosine distance, so similarity is 1 - score.
type EmbeddingDocument = {
  key: string
  score: string
}

// KNN search is capped at this many results; results beyond this offset are unavailable.
export const KNN_MAX_RESULTS = 100

// A KNN query always returns K verses, however unrelated, so results are cut
// by similarity instead, and expansion (below) widens what can pass.
// Calibrated together for gemini-embedding-2 at 1536 dimensions
// (vectorBuffer.ts) on 22 queries the Bible answers and 8 it cannot
// (src/scripts/embeddingEval/compareSearch.ts): the 8 returned nothing, and
// 52-56 of the 71 verses expected for the 22 were kept (the rephrasings vary a
// little between runs), against 46 without expansion. Each model scores on its own scale (text-embedding-3-small put
// good matches near 0.5), so recalibrate whenever the model, the expansion
// prompt or these values change.
//
// Below this even the best match is unrelated: the query gets no results.
export const MIN_TOP_SIMILARITY = 0.72
// Otherwise each result must reach this to be returned.
export const MIN_SIMILARITY = 0.7

// Only searches this short are expanded. Longer ones already describe what
// they look for and gained little, and skipping them saves the ~2 s the
// expansion call takes.
export const MAX_WORDS_TO_EXPAND = 3

// Rephrasings in the Bible's own words match their verses more closely than a
// reader's wording does, so without this their results crowd out those of the
// search as typed.
export const EXPANSION_SIMILARITY_DISCOUNT = 0.03

export type RankedVerse = {
  key: string
  similarity: number
}

// The KNN_MAX_RESULTS verses nearest one query vector, best first. Always the
// full window: a KNN query returns at most K documents, so sizing K to the
// requested page would make `total` (and therefore `totalPages`) count only
// the verses up to that page, not every one that passes the similarity cut.
export const knnWindow = async (
  client: ReturnType<typeof createClient>,
  vector: number[],
): Promise<RankedVerse[]> => {
  const results = (await client.ft.search(
    EMBEDDING_INDEX,
    `*=>[KNN ${KNN_MAX_RESULTS} @embedding $vec AS score]`,
    {
      PARAMS: {
        vec: toFloat32Buffer(vector),
      },
      LIMIT: {
        from: 0,
        size: KNN_MAX_RESULTS,
      },
      SORTBY: {
        BY: "score",
        DIRECTION: "ASC",
      },
      RETURN: ["key", "score"],
      DIALECT: 2,
    },
  )) as SearchReply

  return (results?.documents ?? []).map((doc) => {
    const { key, score } = doc.value as unknown as EmbeddingDocument
    return { key, similarity: 1 - Number(score) }
  })
}

// Merges the windows of the search as typed (first) and of its rephrasings.
// Each verse keeps its best similarity to any of them, the rephrasings'
// discounted, which keeps the relevance cut on the scale it was calibrated on
// (a rank fusion would not), and the merged list is held to the same window as
// a single query.
export const fuseByBestSimilarity = (
  windows: RankedVerse[][],
  discount = EXPANSION_SIMILARITY_DISCOUNT,
): RankedVerse[] => {
  const best = new Map<string, number>()
  windows.forEach((window, i) => {
    const penalty = i === 0 ? 0 : discount
    for (const { key, similarity } of window) {
      const score = similarity - penalty
      const current = best.get(key)
      if (current === undefined || score > current) {
        best.set(key, score)
      }
    }
  })
  return [...best]
    .map(([key, similarity]) => ({ key, similarity }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, KNN_MAX_RESULTS)
}

// Keeps only relevant verses from a best-first ranking: none when even the
// best falls short of minTop, otherwise those reaching min.
export const cutByRelevance = (
  ranked: RankedVerse[],
  minTop = MIN_TOP_SIMILARITY,
  min = MIN_SIMILARITY,
): RankedVerse[] =>
  ranked.length > 0 && ranked[0].similarity >= minTop
    ? ranked.filter((verse) => verse.similarity >= min)
    : []

export type Ranking = {
  verses: RankedVerse[]
  // The expansion call failed, so the search ran as typed only.
  degraded: boolean
}

export const shouldExpand = (search: string): boolean =>
  search.trim().split(/\s+/).length <= MAX_WORDS_TO_EXPAND

// Ranks verses for the search as typed and, for a short one, for its
// rephrasings in the Bible's own words (see expandQuery), all embedded in one
// request.
export const rankVerses = async (
  client: ReturnType<typeof createClient>,
  search: string,
): Promise<Ranking> => {
  const expansions = shouldExpand(search) ? await expandQuery(search) : []
  const vectors = await generateQueryEmbeddings([search, ...(expansions ?? [])])
  const windows = await Promise.all(
    vectors.map((vector) => knnWindow(client, vector)),
  )
  return {
    verses: fuseByBestSimilarity(windows),
    degraded: expansions === null,
  }
}

export const semanticSearchVerses = async (
  client: ReturnType<typeof createClient>,
  search: string,
  page: number,
  pageSize: number,
): Promise<{ page: VersePage; degraded: boolean }> => {
  const offset = (page - 1) * pageSize

  // Defensive: the controller rejects out-of-window pages with a 400 so this
  // ambiguous zeroed page is unreachable over HTTP, but a direct caller should
  // still not pay for an embedding it cannot use.
  if (offset >= KNN_MAX_RESULTS) {
    return {
      page: {
        verses: [],
        total: 0,
        currentPage: page,
        totalPages: 0,
      },
      degraded: false,
    }
  }

  const ranking = await rankVerses(client, search)
  const relevant = cutByRelevance(ranking.verses)

  const totalResults = relevant.length
  const totalPages = Math.ceil(totalResults / pageSize)

  const verseKeys = relevant
    .slice(offset, offset + pageSize)
    .map((verse) => verse.key)

  const verses: Verse[] = []
  if (verseKeys.length > 0) {
    // One round trip for the whole page. With the "$" path each entry comes
    // back as a single-element array (or null for missing keys).
    const versesData = await client.json.mGet(verseKeys, "$")
    for (const doc of versesData) {
      const verse = (doc as unknown as Verse[] | null)?.[0]
      if (verse) {
        verses.push(verse)
      }
    }
  }

  return {
    page: {
      verses,
      total: totalResults,
      currentPage: page,
      totalPages,
    },
    degraded: ranking.degraded,
  }
}
