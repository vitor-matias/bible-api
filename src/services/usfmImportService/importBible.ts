import * as fs from "node:fs"
import * as path from "node:path"
import type { createClient } from "redis"
import { flushDatabase } from "../../util/flushDatabase"
import { generateEmbedding } from "../openai/embeddings"
import { readBook } from "./readBook"
import { storeBook } from "./storeBook"
import { getEmbeddingFailureCount } from "./storeChapter"

// Written only after a full import finishes, so a crash mid-import leaves the
// marker absent and the next start reimports instead of serving partial data.
// The suffix is part of the storage format: bump it when the layout changes so
// existing databases reimport instead of being read with the wrong assumptions.
// v3: plain string values and binary vectors, no RedisJSON or RediSearch.
export const IMPORT_COMPLETE_KEY = "importComplete:v3"

type Client = ReturnType<typeof createClient>

export const isDataImported = async (client: Client): Promise<boolean> =>
  (await client.exists(IMPORT_COMPLETE_KEY)) === 1

// Flushes the database, then loads every USFM book in `textsPath` into it,
// embedding each verse. The completion marker is only written if every chapter
// embedded, so an incomplete import is redone rather than served.
export const importBible = async (
  client: Client,
  textsPath: string,
): Promise<{ embeddingFailures: number }> => {
  const start = Date.now()

  // The import deletes everything before it embeds anything, so confirm OpenAI
  // answers first: a missing, rotated or out-of-quota key then fails while any
  // old data still serves.
  await generateEmbedding("teste")

  // flushDatabase also clears any stale completion marker.
  await flushDatabase()

  console.log(textsPath)
  // readdirSync order is filesystem-dependent. Sorting keeps book numbering
  // (which feeds searchId) and introduction slug suffixes identical across
  // machines and reimports.
  const files = fs
    .readdirSync(textsPath)
    .filter((file) => file.endsWith(".usfm"))
    .sort()

  for (const file of files) {
    console.log(file)
    const bibleData = await readBook(path.join(textsPath, file))
    await storeBook(client, bibleData, file)
  }

  const embeddingFailures = getEmbeddingFailureCount()
  if (embeddingFailures > 0) {
    // Leaving the marker unwritten keeps the next start from silently serving
    // a corpus whose semantic index is permanently missing these chapters.
    console.warn(
      `WARNING: embeddings failed for ${embeddingFailures} chapter(s); semantic search would miss their verses, so the import is not marked complete and the next start will reimport.`,
    )
  } else {
    await client.set(IMPORT_COMPLETE_KEY, "1")
  }

  console.log(`load complete. took ${(Date.now() - start) / 1000}s`)

  return { embeddingFailures }
}
