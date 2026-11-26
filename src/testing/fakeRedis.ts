import type { createClient } from "redis"

type Client = ReturnType<typeof createClient>

// An in-memory stand-in for the handful of Redis commands the import and
// search code use, so their logic can be tested without a server. Only what
// those callers need is modelled: JSON documents (whole-document or "$.field"
// reads), strings, lists, sets, hashes, MULTI, a key SCAN, UNLINK, DEL, and
// stubbed FT.SEARCH, FT.INFO and MODULE LIST.
export const createFakeRedis = (
  search: (index: string, query: string, options: unknown) => unknown = () => ({
    total: 0,
    documents: [],
  }),
  info: (index: string) => unknown = () => ({}),
  moduleList: () => unknown = () => [],
) => {
  const json = new Map<string, unknown>()
  const strings = new Map<string, string>()
  const sets = new Map<string, Set<string>>()
  const hashes = new Map<string, Record<string, unknown>>()
  const lists = new Map<string, string[]>()
  const clone = <T>(value: T): T => structuredClone(value)
  // Hash writes merge fields, as HSET does.
  const hSet = (key: string, value: Record<string, unknown>) => {
    hashes.set(key, { ...hashes.get(key), ...value })
    return 1
  }
  const sAdd = (key: string, member: string) => {
    const set = sets.get(key) ?? new Set<string>()
    set.add(member)
    sets.set(key, set)
    return 1
  }
  const sRem = (key: string, member: string) =>
    sets.get(key)?.delete(member) ? 1 : 0
  const del = (key: string) =>
    [json, strings, sets, hashes, lists].filter((store) => store.delete(key))
      .length

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
    mGet: async (keys: string[]) => keys.map((key) => strings.get(key) ?? null),
    // NX is honoured; expiry is not modelled.
    set: async (key: string, value: string, options?: { condition?: "NX" }) => {
      if (options?.condition === "NX" && strings.has(key)) return null
      strings.set(key, value)
      return "OK"
    },
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
    sAdd: async (key: string, member: string) => sAdd(key, member),
    sMembers: async (key: string) => [...(sets.get(key) ?? [])],
    sIsMember: async (key: string, member: string) =>
      sets.get(key)?.has(member) ? 1 : 0,
    sRem: async (key: string, member: string) => sRem(key, member),
    hSet: async (
      key: string,
      field: string | Record<string, unknown>,
      value?: unknown,
    ) => hSet(key, typeof field === "string" ? { [field]: value } : field),
    hGetAll: async (key: string) => ({ ...(hashes.get(key) ?? {}) }),
    hIncrBy: async (key: string, field: string, by: number) => {
      const value = Number(hashes.get(key)?.[field] ?? 0) + by
      hSet(key, { [field]: String(value) })
      return value
    },
    del: async (key: string) => del(key),
    sCard: async (key: string) => sets.get(key)?.size ?? 0,
    // One batch per call, matching only a trailing-"*" prefix pattern.
    scanIterator: async function* ({ MATCH }: { MATCH: string }) {
      const prefix = MATCH.replace(/\*$/, "")
      yield [...hashes.keys(), ...strings.keys()].filter((key) =>
        key.startsWith(prefix),
      )
    },
    unlink: async (keys: string[]) =>
      keys.filter((key) => strings.delete(key) || hashes.delete(key)).length,
    moduleList: async () => moduleList(),
    multi: () => {
      const queued: (() => number)[] = []
      const transaction = {
        hSet: (key: string, value: Record<string, unknown>) => {
          queued.push(() => hSet(key, value))
          return transaction
        },
        sAdd: (key: string, member: string) => {
          queued.push(() => sAdd(key, member))
          return transaction
        },
        sRem: (key: string, member: string) => {
          queued.push(() => sRem(key, member))
          return transaction
        },
        del: (key: string) => {
          queued.push(() => del(key))
          return transaction
        },
        exec: async () => queued.map((command) => command()),
      }
      return transaction
    },
    ft: {
      search: async (...args: Parameters<typeof search>) => search(...args),
      SEARCH: async (...args: Parameters<typeof search>) => search(...args),
      searchNoContent: async (...args: Parameters<typeof search>) =>
        search(...args),
      info: async (index: string) => info(index),
    },
  }

  return {
    client: client as unknown as Client,
    json,
    strings,
    sets,
    hashes,
    lists,
  }
}
