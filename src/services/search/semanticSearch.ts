import type { createClient } from "redis"
import { mGetJson } from "../../util/jsonStore"
import { toQueryVector } from "../../util/vectorBuffer"
import { generateEmbedding } from "../openai/embeddings"
import { getVectorIndex, nearest } from "./searchIndex"

// The search returns at most this many results; results beyond this offset are
// unavailable.
export const KNN_MAX_RESULTS = 100

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

  const queryVector = toQueryVector(await generateEmbedding(search))

  // Always rank the full window: sizing it to the requested page would make
  // `total` (and therefore `totalPages`) shrink to that page and hide the rest
  // of the results.
  const ranked = nearest(getVectorIndex(), queryVector, KNN_MAX_RESULTS)

  if (ranked.length === 0) {
    return {
      verses: [],
      total: 0,
      currentPage: page,
      totalPages: 0,
    }
  }

  const totalPages = Math.ceil(ranked.length / pageSize)
  const pageKeys = ranked
    .slice(offset, offset + pageSize)
    .map((result) => result.key)

  const verses: Verse[] = []
  for (const verse of await mGetJson<Verse>(client, pageKeys)) {
    if (verse) {
      verses.push(verse)
    }
  }

  return {
    verses,
    total: ranked.length,
    currentPage: page,
    totalPages,
  }
}
