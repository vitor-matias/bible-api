import type { NextFunction, Request, Response } from "express"

export const checkCache = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const { url } = req
  const { client } = res.locals
  try {
    const cachedResponse = await client.json.get(url)
    if (cachedResponse != null) {
      console.log("Cache hit")
      res.send(cachedResponse)
    } else {
      console.log("Cache miss")

      // Store the original send function
      const originalSend = res.send.bind(res)

      // Override the send function
      res.send = (body) => {
        // Cache the response only for successful responses
        if (res.statusCode >= 200 && res.statusCode < 300) {
          client.json.set(url, "$", body).catch((err: Error) => {
            console.error(`Error setting cache: ${err}`)
          })

          client.expire(url, 86400)
        }

        // Call the original send function
        return originalSend(body)
      }

      next()
    }
  } catch (error) {
    console.error(`Error in checkCache middleware: ${error}`)
    next()
  }
}
