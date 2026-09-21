import type { createClient } from "redis"
import {
  createEmbeddingIndex,
  EMBEDDING_INDEX,
  EMBEDDING_KEY_PREFIX,
  getEmbeddingIndexInfo,
  verifyEmbeddingIndex,
} from "./embeddingIndex"
import { toFloat32Buffer } from "./vectorBuffer"

type Client = ReturnType<typeof createClient>

type LegacyEmbedding = { key: string; embedding: number[] }

const BATCH_SIZE = 500

const isMissingIndex = (error: unknown): boolean =>
  /unknown index name/i.test(String(error))

// The index is only dropped when it is the legacy JSON one. A second instance
// starting while the first is mid-conversion must not tear down the hash index
// the first already created.
const dropLegacyIndex = async (client: Client): Promise<void> => {
  try {
    const info = await getEmbeddingIndexInfo(client)
    // Without DD, so the documents themselves are kept.
    if (info.index_definition.key_type === "JSON") {
      await client.ft.dropIndex(EMBEDDING_INDEX)
    }
  } catch (error) {
    if (!isMissingIndex(error)) throw error
  }
}

const convertBatch = async (
  client: Client,
  keys: string[],
): Promise<number> => {
  // SCAN replies with an empty batch whenever a cursor step matches nothing,
  // and JSON.MGET with no keys is an error.
  if (keys.length === 0) return 0

  // Null for a key another instance already converted, which is skipped.
  const docs = await client.json.mGet(keys, "$")
  const multi = client.multi()
  let converted = 0

  keys.forEach((key, i) => {
    const doc = (docs[i] as unknown as LegacyEmbedding[] | null)?.[0]
    if (!doc?.embedding) return
    let embedding: Buffer
    try {
      embedding = toFloat32Buffer(doc.embedding)
    } catch (error) {
      // Name the key: with ~35k of them, the bare message is not actionable.
      throw new Error(
        `${key}: ${error instanceof Error ? error.message : error}`,
      )
    }
    // HSET on a JSON key is WRONGTYPE, so the key is unlinked first. Both run
    // in one transaction: no other client ever sees the vector missing.
    multi.unlink(key).hSet(key, { key: doc.key, embedding })
    converted++
  })

  if (converted > 0) await multi.exec()
  return converted
}

/**
 * Converts embeddings stored as RedisJSON arrays (the v2 layout) into hashes
 * of raw float32 bytes, in place. The old arrays hold float32 values widened
 * to doubles, so nothing is lost, and the books and verses are never touched.
 * That is the point of doing this instead of a flush and reimport: the primary
 * data keeps serving, nothing is re-embedded, and a missing or out-of-quota
 * OpenAI key cannot leave the API with no data.
 *
 * Safe to interrupt and to run from several instances at once: converting a
 * key that is already a hash is a no-op, so the next start simply resumes.
 * Semantic search is unavailable until the new index has finished building.
 */
export const migrateEmbeddingsToHashes = async (
  client: Client,
): Promise<number> => {
  await dropLegacyIndex(client)

  let total = 0
  // SCAN can miss keys that change while it runs, so it repeats until a full
  // pass finds no JSON embedding left.
  for (;;) {
    let pass = 0
    for await (const keys of client.scanIterator({
      MATCH: `${EMBEDDING_KEY_PREFIX}*`,
      TYPE: "ReJSON-RL",
      COUNT: BATCH_SIZE,
    })) {
      pass += await convertBatch(client, keys)
    }
    if (pass === 0) break
    total += pass
  }

  try {
    await createEmbeddingIndex(client)
  } catch (error) {
    if (!/already exists/i.test(String(error))) throw error
  }
  await verifyEmbeddingIndex(client)
  return total
}
