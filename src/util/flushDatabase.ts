import { createClient } from "redis"

export const flushDatabase = async () => {
  const client = createClient()
  await client.connect()
  await client.flushAll()
  await client.quit()
}
