import { createClient } from "redis"

type Client = ReturnType<typeof createClient>

// One connection is shared by every request and by the health check. The
// "error" listener is required: without it, node-redis throws on connection loss
// and crashes the process. node-redis reconnects automatically and queues
// commands meanwhile.
let client: Client | undefined

// Concurrent callers arriving before the socket is open share one handshake;
// calling connect() twice on the same client throws.
let connecting: Promise<unknown> | undefined

export const getClient = async (): Promise<Client> => {
  if (!client) {
    client = createClient({ url: process.env.DB_URL })
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
