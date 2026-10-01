import type { createClient } from "redis"

type Client = ReturnType<typeof createClient>

// Written only after a full import finishes, so a crash mid-import leaves the
// marker absent and the next start reimports instead of serving partial data.
// The suffix is part of the storage format: bump it when the layout changes so
// existing databases reimport instead of being read with the wrong assumptions.
// v3: plain string values and binary vectors, no RedisJSON or RediSearch.
export const IMPORT_COMPLETE_KEY = "importComplete:v3"

// True when an import finished AND the database really holds verses. The marker
// alone is not enough: an import of a folder with no texts used to write it too,
// and a database in that state was then never imported again.
export const isDataImported = async (client: Client): Promise<boolean> => {
  if ((await client.exists(IMPORT_COMPLETE_KEY)) !== 1) return false

  // SCAN pages can come back empty even when matches remain, so keep going until
  // one holds a key or the whole keyspace has been visited.
  for await (const keys of client.scanIterator({
    MATCH: "verse:*",
    COUNT: 1000,
  })) {
    if (keys.length > 0) return true
  }

  return false
}
