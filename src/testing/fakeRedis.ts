import type { createClient } from "redis"

type Client = ReturnType<typeof createClient>

// An in-memory stand-in for the handful of Redis commands the import and
// search code use, so their logic can be tested without a server. Only what
// those callers need is modelled: strings (JSON documents are stored as their
// text, see util/jsonStore.ts, and vectors as raw bytes), lists, sets, a key
// SCAN, and MULTI for writing several strings at once: enough to load the
// search index (loadSearchIndex) from what a test stored.
export const createFakeRedis = () => {
  const strings = new Map<string, string | Buffer>()
  const sets = new Map<string, Set<string>>()
  const lists = new Map<string, string[]>()

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
    rPush: async (key: string, value: string) => {
      const list = lists.get(key) ?? []
      list.push(value)
      lists.set(key, list)
      return list.length
    },
    lRange: async (key: string, start: number, stop: number) =>
      (lists.get(key) ?? []).slice(start, stop === -1 ? undefined : stop + 1),
    lPos: async (key: string, value: string) => {
      const index = (lists.get(key) ?? []).indexOf(value)
      return index === -1 ? null : index
    },
    sAdd: async (key: string, member: string) => {
      const set = sets.get(key) ?? new Set<string>()
      set.add(member)
      sets.set(key, set)
      return 1
    },
    sMembers: async (key: string) => [...(sets.get(key) ?? [])],
    sRem: async (key: string, member: string) =>
      sets.get(key)?.delete(member) ? 1 : 0,
    sCard: async (key: string) => sets.get(key)?.size ?? 0,
    // One batch per call, matching only a trailing-"*" prefix pattern.
    scanIterator: async function* ({ MATCH }: { MATCH: string }) {
      const prefix = MATCH.replace(/\*$/, "")
      yield [...strings.keys()].filter((key) => key.startsWith(prefix))
    },
    // Vectors are read back as raw bytes, through a typed view of the client.
    withTypeMapping: () => ({
      mGet: async (keys: string[]) =>
        keys.map((key) => {
          const value = strings.get(key)
          return Buffer.isBuffer(value) ? value : null
        }),
    }),
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

  return {
    client: client as unknown as Client,
    strings,
    sets,
    lists,
    document,
  }
}
