import type { NextFunction, Request, Response } from "express"

const CACHE_TTL_SECONDS = 86400

/**
 * Caches successful JSON responses in Redis for 24 hours.
 *
 * The cache key is built from the request path plus an allowlist of query
 * parameters, so arbitrary query strings cannot inflate the keyspace. Only
 * 200 responses are stored — errors and partial results are never cached.
 *
 * `valueParams` are URL-encoded into the key, so values containing `&`/`=`
 * cannot collide with other parameter combinations. `flagParams` are
 * booleans: they enter the key only as `name=true` when the value is
 * exactly "true", so arbitrary flag values all share the "off" key.
 */
export const cacheResponse =
  (valueParams: string[] = [], flagParams: string[] = []) =>
  async (req: Request, res: Response, next: NextFunction) => {
    const { client } = res.locals

    const pairs: string[] = []
    for (const name of valueParams) {
      const value = req.query[name]
      if (typeof value === "string" && value !== "") {
        pairs.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
      }
    }
    for (const name of flagParams) {
      if (req.query[name] === "true") {
        pairs.push(`${encodeURIComponent(name)}=true`)
      }
    }

    const params = pairs.sort((a, b) => a.localeCompare(b)).join("&")

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
