import type { NextFunction, Request, Response } from "express"

const CACHE_PREFIX = "cache:"
const CACHE_TTL_SECONDS = 86400

// Entries are stored as plain strings rather than RedisJSON. Nothing ever reads
// a path inside a cached response, so RedisJSON only added cost: it parses the
// body into a tree that occupies several times the raw bytes and blocks the
// server while it is built. A ceiling still guards against a pathological
// response, but it is deliberately far above the largest real one — the
// full-Bible listing is ~20 MB and is precisely the response worth caching.
const MAX_CACHEABLE_BYTES = 64 * 1024 * 1024

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
    const cached = await client.get(cacheKey)
    if (cached != null) {
      console.log("Cache hit")
      // Replay the stored JSON verbatim. Parsing it back into an object just to
      // have res.json re-serialize it would be two extra passes over the body.
      return res.type("application/json").send(cached)
    }

    console.log("Cache miss")

    // Store the original json function
    const originalJson = res.json.bind(res)

    // Override the json function to cache successful responses only.
    res.json = (body) => {
      // Only 200s are cached, so the status never needs storing alongside.
      if (res.statusCode === 200) {
        const payload = JSON.stringify(body)

        if (
          payload !== undefined &&
          Buffer.byteLength(payload) <= MAX_CACHEABLE_BYTES
        ) {
          // SET carries its own expiry, so a key can never be left without a
          // TTL (volatile-lru only evicts keys that have one).
          client
            .set(cacheKey, payload, { EX: CACHE_TTL_SECONDS })
            .catch((err: Error) => {
              console.error(`Error setting cache: ${err}`)
            })
        } else {
          console.warn("Response too large to cache")
        }
      }
      return originalJson(body)
    }

    next()
  } catch (error) {
    console.error(`Error in checkCache middleware: ${error}`)
    next()
  }
}
