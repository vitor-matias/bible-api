import type { createClient } from "redis"

// Every book, verse and intro is a RedisJSON document and both searches run on
// RediSearch. Plain Redis has neither, and only says so at the first FT.CREATE,
// by which time flushDb has already emptied it.
const REQUIRED_MODULES = [
  { name: "ReJSON", label: "RedisJSON" },
  { name: "search", label: "RediSearch" },
]

export const assertRedisModules = async (
  client: ReturnType<typeof createClient>,
): Promise<void> => {
  let loaded: string[]
  try {
    loaded = (await client.moduleList()).map((module) =>
      String(module.name).toLowerCase(),
    )
  } catch {
    // Some managed services disable MODULE. The first command that needs a
    // module will then report it, as before.
    return
  }

  const missing = REQUIRED_MODULES.filter(
    ({ name }) => !loaded.includes(name.toLowerCase()),
  )
  if (missing.length > 0) {
    throw new Error(
      `The Redis server at DB_URL has no ${missing.map(({ label }) => label).join(" or ")} module. This app needs Redis Stack (docker/docker-compose.yml runs redis/redis-stack), not plain Redis.`,
    )
  }
}
