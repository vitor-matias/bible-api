import { createClient } from "redis"

export const flushDatabase = async () => {
  const client = createClient({ url: process.env.DB_URL })
  client.on("error", (err) => console.error(`Redis client error: ${err}`))
  await client.connect()
  try {
    // flushDb only clears the current logical DB, unlike flushAll which wipes
    // every DB on the (possibly shared) Redis instance. There are no indexes to
    // recreate afterwards: search runs in memory (see searchIndex.ts).
    await client.flushDb()
  } finally {
    await client.quit()
  }
}
