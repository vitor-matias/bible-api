import type { createClient, SearchReply } from "redis"
import { generateEmbedding } from "../openai/embeddings"

/**
 * Performs semantic search for Bible verses using OpenAI embeddings and Redis vector search.
 *
 * This function generates an embedding for the search query and uses KNN (K-Nearest Neighbors)
 * vector similarity search to find verses with similar semantic meaning, rather than exact keyword matches.
 *
 * @param client - The Redis client instance for database operations.
 * @param search - The search query text to find semantically similar verses.
 * @param page - The page number for pagination (1-indexed).
 * @param pageSize - The number of results per page.
 * @returns A promise that resolves to a VersePage object containing matching verses and pagination metadata.
 *
 * @throws {Error} If the search query is empty or exceeds character limits.
 * @throws {Error} If the OpenAI embedding generation fails.
 * @throws {Error} If the Redis vector search operation fails.
 */
export const semanticSearchVerses = async (
  client: ReturnType<typeof createClient>,
  search: string,
  page: number,
  pageSize: number,
): Promise<VersePage> => {
  console.log(
    `Semantic search for: ${search}, page: ${page}, pageSize: ${pageSize}`,
  )

  const offset = (page - 1) * pageSize

  // Generate embedding for the search query
  const queryEmbedding = await generateEmbedding(search)

  // Convert the embedding to a Buffer for Redis vector search
  const embeddingBuffer = Buffer.from(new Float32Array(queryEmbedding).buffer)

  // Request a reasonable max results for KNN and paginate in memory
  // Ensure we fetch at least enough to cover the requested page, capped by a max
  const KNN_MAX_RESULTS = 100
  const requestedSize = Math.min(KNN_MAX_RESULTS, offset + pageSize)

  // Perform vector search using KNN
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

  console.log(
    `KNN fetched docs=${results?.documents?.length ?? 0}, requestedSize=${requestedSize}, offset=${offset}, pageSize=${pageSize}, total=${results?.total ?? 0}`,
  )

  if (!results || results.total === 0) {
    return {
      verses: [],
      total: 0,
      currentPage: page,
      totalPages: 0,
    }
  }

  // Paginate results in memory after KNN search
  // Note: We fetched up to `requestedSize`, so slice for the requested page
  const paginatedDocs = results.documents.slice(offset, offset + pageSize)
  const totalResults = Math.min(results.total, KNN_MAX_RESULTS)
  const totalPages = Math.ceil(totalResults / pageSize)

  if (page > totalPages) {
    return {
      verses: [],
      total: totalResults,
      currentPage: page,
      totalPages: totalPages,
    }
  }

  console.log(`Found ${totalResults} results (page ${page}/${totalPages})`)

  // Fetch the actual verse data from Redis using the keys stored with embeddings
  const verseKeys = paginatedDocs.map((doc) => {
    const embeddingData = doc.value as unknown as {
      key: string
      embedding: number[]
    }
    return embeddingData.key
  })

  // Batch fetch all verses at once
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
