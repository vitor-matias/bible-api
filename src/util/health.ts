import { type ImportState, isDataLoaded } from "./importState"

// What a health check needs from the database connection.
type Pingable = { isReady: boolean; ping(): Promise<unknown> }

// Render gives a health check five seconds; this leaves room to answer.
const DEFAULT_PING_TIMEOUT_MS = 1500

// True if the database answers a PING in time. A connection that is not ready
// (still connecting, or reconnecting after a loss) fails at once instead of
// queueing the command behind the outage.
export const pingDatabase = async (
  client: Pingable | undefined,
  timeoutMs = DEFAULT_PING_TIMEOUT_MS,
): Promise<boolean> => {
  if (!client?.isReady) return false

  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("PING timed out")), timeoutMs)
  })

  try {
    await Promise.race([client.ping(), timeout])
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export type HealthReport = {
  status: ImportState
  database: "ok" | "unreachable"
  // What the search loaded; absent until the index has been built.
  index?: { verses: number; vectors: number }
}

// The response to GET /health. It is healthy (200) only when the data is loaded
// AND the database answers; "degraded" still serves, since only some embeddings
// are missing. Anything else is 503, which tells a load balancer or orchestrator
// not to send traffic yet (or any more).
export const buildHealth = (
  status: ImportState,
  databaseReachable: boolean,
  index?: { verses: number; vectors: number },
): { code: 200 | 503; body: HealthReport } => {
  return {
    code: isDataLoaded(status) && databaseReachable ? 200 : 503,
    body: {
      status,
      database: databaseReachable ? "ok" : "unreachable",
      ...(index && { index }),
    },
  }
}
