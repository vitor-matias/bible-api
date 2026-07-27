import type { NextFunction, Request, Response } from "express"

const CACHE_PREFIX = "cache:"
const CACHE_TTL_SECONDS = 86400

type CachedResponse = {
  status: number
  body: unknown
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
      if (res.statusCode === 200) {
        const payload: CachedResponse = { status: res.statusCode, body }
        client.json
          .set(cacheKey, "$", payload)
          .then(() => client.expire(cacheKey, CACHE_TTL_SECONDS))
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
