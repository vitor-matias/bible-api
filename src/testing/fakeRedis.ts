import type { createClient } from "redis"

type Client = ReturnType<typeof createClient>

// An in-memory stand-in for the handful of Redis commands the import and
// search code use, so their logic can be tested without a server. Only what
// those callers need is modelled: JSON documents (whole-document or "$.field"
// reads), strings, sets, hashes written through MULTI, and a stubbed
// FT.SEARCH.
export const createFakeRedis = (
  search: (index: string, query: string, options: unknown) => unknown = () => ({
    total: 0,
    documents: [],
  }),
) => {
  const json = new Map<string, unknown>()
  const strings = new Map<string, string>()
  const sets = new Map<string, Set<string>>()
  const hashes = new Map<string, Record<string, unknown>>()
  const clone = <T>(value: T): T => structuredClone(value)

  const client = {
    json: {
      set: async (key: string, _path: string, value: unknown) => {
        json.set(key, clone(value))
        return "OK"
      },
      get: async (key: string, options?: { path?: string }) => {
        if (!json.has(key)) return null
        const doc = clone(json.get(key)) as Record<string, unknown>
        const field = options?.path?.match(/^\$\.(\w+)$/)?.[1]
        return field ? [doc[field]] : doc
      },
      mGet: async (keys: string[], _path: string) =>
        keys.map((key) => (json.has(key) ? [clone(json.get(key))] : null)),
    },
    get: async (key: string) => strings.get(key) ?? null,
    set: async (key: string, value: string) => {
      strings.set(key, value)
      return "OK"
    },
    sAdd: async (key: string, member: string) => {
      const set = sets.get(key) ?? new Set<string>()
      set.add(member)
      sets.set(key, set)
      return 1
    },
    multi: () => {
      const queued: [string, Record<string, unknown>][] = []
      const transaction = {
        hSet: (key: string, value: Record<string, unknown>) => {
          queued.push([key, value])
          return transaction
        },
        exec: async () => {
          for (const [key, value] of queued) hashes.set(key, value)
          return queued.map(() => 1)
        },
      }
      return transaction
    },
    ft: {
      search: async (...args: Parameters<typeof search>) => search(...args),
    },
  }

  return { client: client as unknown as Client, json, strings, sets, hashes }
}
