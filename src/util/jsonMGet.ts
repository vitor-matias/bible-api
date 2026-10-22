import type { createClient } from "redis"

// Fetches whole RedisJSON documents in one round trip. With the "$" path each
// entry comes back as a single-element array (or null for a missing key);
// this unwraps that to the document itself, keeping one entry per key.
export const jsonMGet = async <T>(
  client: ReturnType<typeof createClient>,
  keys: string[],
): Promise<(T | null)[]> => {
  if (keys.length === 0) return []

  const docs = await client.json.mGet(keys, "$")

  return docs.map((doc) => (doc as unknown as T[] | null)?.[0] ?? null)
}
