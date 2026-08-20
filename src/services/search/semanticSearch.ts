import type { createClient, SearchReply } from "redis"
import { generateEmbedding } from "../openai/embeddings"

type EmbeddingDocument = {
  key: string
  embedding: number[]
}

// KNN search is capped at this many results; results beyond this offset are unavailable.
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

  const queryEmbedding = await generateEmbedding(search)
  const embeddingBuffer = Buffer.from(new Float32Array(queryEmbedding).buffer)

  // Always ask for the full window: a KNN query returns at most K documents, so
  // sizing K to the requested page would make `total` (and therefore
  // `totalPages`) shrink to that page and hide the rest of the results.
  const results = (await client.ft.search(
    "idx:verseEmbeddings",
    `*=>[KNN ${KNN_MAX_RESULTS} @embedding $vec AS score]`,
    {
      PARAMS: {
        vec: embeddingBuffer,
      },
      LIMIT: {
        from: 0,
        size: KNN_MAX_RESULTS,
      },
      SORTBY: {
        BY: "score",
        DIRECTION: "ASC",
      },
      RETURN: ["key"],
      DIALECT: 2,
    },
  )) as SearchReply

  if (!results || results.total === 0) {
    return {
      verses: [],
      total: 0,
      currentPage: page,
      totalPages: 0,
    }
  }

  const paginatedDocs = results.documents.slice(offset, offset + pageSize)
  const totalResults = Math.min(results.total, KNN_MAX_RESULTS)
  const totalPages = Math.ceil(totalResults / pageSize)

  const verseKeys = paginatedDocs.map(
    (doc) => (doc.value as unknown as EmbeddingDocument).key,
  )

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
    verses,
    total: totalResults,
    currentPage: page,
    totalPages,
  }
}
