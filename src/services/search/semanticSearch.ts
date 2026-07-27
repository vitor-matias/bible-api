import type { createClient, SearchReply } from "redis"
import { generateEmbedding } from "../openai/embeddings"

type EmbeddingDocument = {
  key: string
  embedding: number[]
}

// KNN search is capped at this many results; results beyond this offset are unavailable.
const KNN_MAX_RESULTS = 100

export const semanticSearchVerses = async (
  client: ReturnType<typeof createClient>,
  search: string,
  page: number,
  pageSize: number,
): Promise<VersePage> => {
  const offset = (page - 1) * pageSize

  // Short-circuit for pages that are beyond the maximum result window
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

  const requestedSize = Math.min(KNN_MAX_RESULTS, offset + pageSize)

  const results = (await client.ft.search(
    "idx:verseEmbeddings",
    `*=>[KNN ${requestedSize} @embedding $vec AS score]`,
    {
      PARAMS: {
        vec: embeddingBuffer,
      },
      LIMIT: {
        from: 0,
        size: requestedSize,
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

  const versesData = await Promise.all(
    verseKeys.map((key) => client.json.get(key)),
  )

  const verses: Verse[] = versesData
    .filter((data) => data !== null)
    .map((data) => data as Verse)

  return {
    verses,
    total: totalResults,
    currentPage: page,
    totalPages,
  }
}
