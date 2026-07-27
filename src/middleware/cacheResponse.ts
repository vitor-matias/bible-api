import type { NextFunction, Request, Response } from "express"

const CACHE_TTL_SECONDS = 86400

/**
 * Caches successful JSON responses in Redis for 24 hours.
 *
 * The cache key is built from the request path plus an allowlist of query
 * parameters, so arbitrary query strings cannot inflate the keyspace. Only
 * 200 responses are stored — errors and partial results are never cached.
 */
export const cacheResponse =
  (relevantParams: string[] = []) =>
  async (req: Request, res: Response, next: NextFunction) => {
    const { client } = res.locals

    const params = relevantParams
      .map((name) => [name, req.query[name]])
      .filter(([, value]) => typeof value === "string" && value !== "")
      .map(([name, value]) => `${name}=${value}`)
      .sort((a, b) => a.localeCompare(b))
      .join("&")

    const querySuffix = params ? `?${params}` : ""
    const key = `cache:${req.path}${querySuffix}`

    try {
      const cachedResponse = await client.get(key)
      if (cachedResponse != null) {
        res.type("application/json").send(cachedResponse)
        return
      }
    } catch (error) {
      console.error(`Error reading cache: ${error}`)
    }

    const originalSend = res.send.bind(res)

    res.send = (body) => {
      if (res.statusCode === 200 && typeof body === "string") {
        client
          .set(key, body, {
            expiration: { type: "EX", value: CACHE_TTL_SECONDS },
          })
          .catch((error: Error) => {
            console.error(`Error setting cache: ${error}`)
          })
      }

      return originalSend(body)
    }

    next()
  }
