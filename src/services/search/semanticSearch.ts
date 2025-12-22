import type { createClient, SearchReply } from "redis"
import { generateEmbedding } from "../openai/embeddings"

export const semanticSearchVerses = async (
  client: ReturnType<typeof createClient>,
  search: string,
  page: number,
  pageSize: number,
): Promise<VersePage> => {
  console.warn(
    `Semantic search for: ${search}, page: ${page}, pageSize: ${pageSize}`,
  )

  const offset = (page - 1) * pageSize

  // Generate embedding for the search query
  const queryEmbedding = await generateEmbedding(search)

  // Convert the embedding to a Buffer for Redis vector search
  const embeddingBuffer = Buffer.from(new Float32Array(queryEmbedding).buffer)

  // Perform vector search using KNN
  const results = (await client.ft.search(
    "idx:verseEmbeddings",
    `*=>[KNN ${offset + pageSize} @embedding $BLOB AS score]`,
    {
      PARAMS: {
        BLOB: embeddingBuffer,
      },
      SORTBY: {
        BY: "score",
        DIRECTION: "ASC",
      },
      LIMIT: {
        from: offset,
        size: pageSize,
      },
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

  const totalPages = Math.ceil(results.total / pageSize)

  if (page > totalPages) {
    return {
      verses: [],
      total: results.total,
      currentPage: page,
      totalPages: totalPages,
    }
  }

  console.warn(`Found ${results.total} results (page ${page}/${totalPages})`)

  // Fetch the actual verse data from Redis using the keys stored with embeddings
  const verses: Verse[] = []
  for (const doc of results.documents) {
    const embeddingData = doc.value as unknown as { key: string; embedding: number[] }
    const verseKey = embeddingData.key

    const verseData = await client.json.get(verseKey)
    if (verseData) {
      verses.push(verseData as Verse)
    }
  }

  return {
    verses,
    total: results.total,
    currentPage: page,
    totalPages,
  }
}
