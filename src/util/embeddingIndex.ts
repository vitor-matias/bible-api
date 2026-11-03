import type { createClient } from "redis"
import { EMBEDDING_DIMENSIONS, EMBEDDING_VECTOR_TYPE } from "./vectorBuffer"

type Client = ReturnType<typeof createClient>

export const EMBEDDING_INDEX = "idx:verseEmbeddings"
export const EMBEDDING_KEY_PREFIX = "embedding:"

const INDEX_BUILD_TIMEOUT_MS = 10 * 60 * 1000

// The part of FT.INFO this codebase reads. The client types the reply loosely,
// so it is asserted once here.
type EmbeddingIndexInfo = {
  indexing: number
  num_docs: number
  hash_indexing_failures: number
  index_definition: { key_type: string }
}

export const getEmbeddingIndexInfo = async (
  client: Client,
): Promise<EmbeddingIndexInfo> =>
  (await client.ft.info(EMBEDDING_INDEX)) as unknown as EmbeddingIndexInfo

// Hashes, not JSON: a vector is stored as its raw float32 bytes (see
// storeChapter). The "key" field is only returned by queries, never searched,
// so it stays out of the schema.
export const createEmbeddingIndex = (client: Client) =>
  client.ft.create(
    EMBEDDING_INDEX,
    {
      embedding: {
        type: "VECTOR",
        ALGORITHM: "HNSW",
        TYPE: EMBEDDING_VECTOR_TYPE,
        DIM: EMBEDDING_DIMENSIONS,
        DISTANCE_METRIC: "COSINE",
      },
    },
    { ON: "HASH", PREFIX: EMBEDDING_KEY_PREFIX },
  )

// Waits for the index to finish building, then checks that it holds every
// stored vector. HSET succeeds for a vector RediSearch cannot index, so a
// shortfall here is the only sign of one.
export const verifyEmbeddingIndex = async (client: Client): Promise<void> => {
  // SCAN can return a key more than once, so count distinct keys.
  const stored = new Set<string>()
  for await (const keys of client.scanIterator({
    MATCH: `${EMBEDDING_KEY_PREFIX}*`,
    COUNT: 1000,
  })) {
    for (const key of keys) stored.add(key)
  }

  const deadline = Date.now() + INDEX_BUILD_TIMEOUT_MS
  let info = await getEmbeddingIndexInfo(client)
  while (Number(info.indexing) !== 0) {
    if (Date.now() > deadline) {
      throw new Error(`${EMBEDDING_INDEX} did not finish building in time`)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
    info = await getEmbeddingIndexInfo(client)
  }

  const indexed = Number(info.num_docs)
  const failures = Number(info.hash_indexing_failures)
  if (indexed !== stored.size || failures > 0) {
    throw new Error(
      `${EMBEDDING_INDEX} holds ${indexed} of ${stored.size} vectors (${failures} indexing failures)`,
    )
  }
}
