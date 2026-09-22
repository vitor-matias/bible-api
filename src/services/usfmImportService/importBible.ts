import * as path from "node:path"
import type { createClient } from "redis"
import { flushDatabase } from "../../util/flushDatabase"
import { generateEmbedding } from "../openai/embeddings"
import { IMPORT_COMPLETE_KEY } from "./importMarker"
import { listUsfmFiles } from "./listUsfmFiles"
import { readBook } from "./readBook"
import { storeBook } from "./storeBook"
import { getEmbeddingFailureCount } from "./storeChapter"

type Client = ReturnType<typeof createClient>

// Flushes the database, then loads every USFM book in `textsPath` into it,
// embedding each verse. The completion marker is only written if every chapter
// embedded, so an incomplete import is redone rather than served.
export const importBible = async (
  client: Client,
  textsPath: string,
): Promise<{ embeddingFailures: number }> => {
  const start = Date.now()

  // Looked up before anything is deleted: a folder with no texts (a wrong path,
  // or one holding other files) must fail here, not after the flush.
  const files = listUsfmFiles(textsPath)

  // The import deletes everything before it embeds anything, so confirm OpenAI
  // answers first: a missing, rotated or out-of-quota key then fails while any
  // old data still serves.
  await generateEmbedding("teste")

  // flushDatabase also clears any stale completion marker.
  await flushDatabase()

  console.log(textsPath)

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
