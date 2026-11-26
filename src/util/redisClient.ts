import { createClient, type RedisClientOptions } from "redis"

// About three seconds of backoff (0.1 + 0.2 + 0.4 + 0.8 + 1.6s) before a
// connection attempt is abandoned.
const MAX_RECONNECT_RETRIES = 5

export type RedisClient = ReturnType<typeof createClient>

// Returns a getter for one lazily opened client its callers share. The options
// are read on first use, after dotenv has loaded. The "error" listener is
// required: without it, node-redis throws on connection loss and crashes the
// process. node-redis reconnects automatically; commands fail fast meanwhile.
export const makeClientGetter = (
  options: () => Pick<RedisClientOptions, "url" | "database">,
): (() => Promise<RedisClient>) => {
  let client: RedisClient | undefined
  // Concurrent requests arriving before the socket is open share one
  // handshake; calling connect() twice on the same client throws.
  let connecting: Promise<unknown> | undefined

  return async () => {
    if (!client) {
      // Without a bound, node-redis queues every command issued during an
      // outage, so a long one lets requests pile up until the process runs out
      // of memory. Failing fast turns them into 500s instead; reconnection
      // still happens in the background.
      client = createClient({
        ...options(),
        disableOfflineQueue: true,
        socket: {
          // The default strategy retries forever, and connect() stays pending
          // through every retry, so with Redis down each request would hang.
          // Giving up after a few seconds turns them into 500s; the client is
          // then closed, and the next request opens it again.
          reconnectStrategy: (retries) =>
            retries >= MAX_RECONNECT_RETRIES
              ? false
              : Math.min(100 * 2 ** retries, 2000),
        },
      })
      client.on("error", (err) => console.error(`Redis client error: ${err}`))
    }
    if (!client.isOpen) {
      connecting ??= client.connect().finally(() => {
        connecting = undefined
      })
      await connecting
    }
    return client
  }
}
