import type { NextFunction, Request, Response } from "express"

const CACHE_PREFIX = "cache:"
const CACHE_TTL_SECONDS = 86400
// /v1/books?withChapters=true serialises to ~20 MB. Storing that as one
// RedisJSON value blocks the Redis event loop on write and crowds out the
// primary data, which has no TTL and so cannot be evicted to make room.
const MAX_CACHEABLE_BYTES = 1024 * 1024

type CachedResponse = {
  status: number
  body: unknown
}

// Serialising here duplicates work express does when sending, but it is the
// only way to know the size before handing a multi-megabyte value to Redis.
const isCacheable = (body: unknown): boolean => {
  const serialized = JSON.stringify(body)

  if (serialized === undefined) return false

  if (Buffer.byteLength(serialized) > MAX_CACHEABLE_BYTES) {
    console.log("Response too large to cache")
    return false
  }

  return true
}

export const checkCache = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const { client } = res.locals
  // Namespacing cache keys keeps them separate from primary data (verses,
  // books) so cache eviction can never drop the source of truth.
  const cacheKey = `${CACHE_PREFIX}${req.originalUrl}`

  try {
    const cached = (await client.json.get(cacheKey)) as CachedResponse | null
    if (cached != null) {
      console.log("Cache hit")
      return res.status(cached.status).json(cached.body)
    }

    console.log("Cache miss")

    // Store the original json function
    const originalJson = res.json.bind(res)

    // Override the json function to cache successful responses only.
    res.json = (body) => {
      if (res.statusCode === 200 && isCacheable(body)) {
        const payload: CachedResponse = { status: res.statusCode, body }
        // Set + expire run in one MULTI so a key can never be left without a
        // TTL (volatile-lru only evicts keys that have one).
        client
          .multi()
          .json.set(cacheKey, "$", payload)
          .expire(cacheKey, CACHE_TTL_SECONDS)
          .exec()
          .catch((err: Error) => {
            console.error(`Error setting cache: ${err}`)
          })
      }
      return originalJson(body)
    }

    next()
  } catch (error) {
    console.error(`Error in checkCache middleware: ${error}`)
    next()
  }
}
