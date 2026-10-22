import type { createClient } from "redis"

type Client = ReturnType<typeof createClient>

// An in-memory stand-in for the handful of Redis commands the import and
// search code use, so their logic can be tested without a server. Only what
// those callers need is modelled: strings (JSON documents are stored as their
// text, see util/jsonStore.ts), vectors written through MULTI as raw bytes, and
// sets.
export const createFakeRedis = () => {
  const strings = new Map<string, string | Buffer>()
  const sets = new Map<string, Set<string>>()

  const text = (key: string): string | null => {
    const value = strings.get(key)
    return typeof value === "string" ? value : null
  }

  const client = {
    get: async (key: string) => text(key),
    set: async (key: string, value: string | Buffer) => {
      strings.set(key, value)
      return "OK"
    },
    mGet: async (keys: string[]) => keys.map(text),
    sAdd: async (key: string, member: string) => {
      const set = sets.get(key) ?? new Set<string>()
      set.add(member)
      sets.set(key, set)
      return 1
    },
    multi: () => {
      const queued: [string, string | Buffer][] = []
      const transaction = {
        set: (key: string, value: string | Buffer) => {
          queued.push([key, value])
          return transaction
        },
        exec: async () => {
          for (const [key, value] of queued) strings.set(key, value)
          return queued.map(() => "OK")
        },
      }
      return transaction
    },
  }

  // A stored JSON document, parsed; undefined when there is none.
  const document = <T = unknown>(key: string): T | undefined => {
    const raw = text(key)
    return raw === null ? undefined : (JSON.parse(raw) as T)
  }

  return { client: client as unknown as Client, strings, sets, document }
}
