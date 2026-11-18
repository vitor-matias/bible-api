import type { createClient } from "redis"

type Client = ReturnType<typeof createClient>

// Values are stored as plain JSON strings instead of RedisJSON documents, so the
// API runs on any Redis-compatible server (Valkey included) and does not depend
// on the RedisJSON module. Nothing ever reads a path inside a stored value.

export const setJson = (
  client: Pick<Client, "set">,
  key: string,
  value: unknown,
) => client.set(key, JSON.stringify(value))

export const getJson = async <T>(
  client: Pick<Client, "get">,
  key: string,
): Promise<T | null> => {
  const raw = await client.get(key)
  return raw === null ? null : (JSON.parse(raw) as T)
}

// One round trip for many keys. An absent key comes back as null, in position.
export const mGetJson = async <T>(
  client: Pick<Client, "mGet">,
  keys: string[],
): Promise<(T | null)[]> => {
  if (keys.length === 0) return []

  const raws = await client.mGet(keys)
  return raws.map((raw) => (raw === null ? null : (JSON.parse(raw) as T)))
}
