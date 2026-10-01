import { createClient } from "redis"

type Client = ReturnType<typeof createClient>

// About three seconds of backoff (0.1 + 0.2 + 0.4 + 0.8 + 1.6s) before a
// connection attempt is abandoned.
const MAX_RECONNECT_RETRIES = 5

// One connection is shared by every request and by the health check. The
// "error" listener is required: without it, node-redis throws on connection loss
// and crashes the process. node-redis reconnects automatically in the
// background; disableOfflineQueue keeps it from also queuing every command
// issued meanwhile, which would otherwise pile up requests until the process
// runs out of memory during a long outage. Commands fail fast instead.
let client: Client | undefined

// Concurrent callers arriving before the socket is open share one handshake;
// calling connect() twice on the same client throws.
let connecting: Promise<unknown> | undefined

export const getClient = async (): Promise<Client> => {
  if (!client) {
    client = createClient({
      url: process.env.DB_URL,
      disableOfflineQueue: true,
      socket: {
        // The default strategy retries forever, and connect() stays pending
        // through every retry, so with the database down each request would
        // hang. Giving up after a few seconds turns them into 500s instead;
        // isOpen then reads false, and the next call below reconnects (this
        // same client, not a new one — confirmed against a real outage).
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

// The client if one exists, without opening or waiting for a connection. For
// callers that must answer quickly whatever state the database is in.
export const peekClient = (): Client | undefined => client
