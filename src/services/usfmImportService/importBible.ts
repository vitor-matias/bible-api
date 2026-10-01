import * as path from "node:path"
import type { createClient } from "redis"
import { flushDatabase } from "../../util/flushDatabase"
import { generateEmbedding } from "../openai/embeddings"
import { IMPORT_COMPLETE_KEY } from "./importMarker"
import { listUsfmFiles } from "./listUsfmFiles"
import { readBook } from "./readBook"
import { retryFailedEmbeddings } from "./retryEmbeddings"
import { storeBook } from "./storeBook"

type Client = ReturnType<typeof createClient>

// Flushes the database, then loads every USFM book in `textsPath` into it,
// embedding each verse. A chapter whose embedding call fails is recorded
// rather than aborting the import: the primary data matters more, and this
// call already tries once to re-embed any recorded chapter before returning,
// since a one-shot `npm run import` run gets no later start to retry on.
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

  // flushDatabase also clears any stale completion marker and the record of
  // chapters whose embeddings failed.
  await flushDatabase()

  console.log(textsPath)

  // One book at a time: storeBook embeds a chapter's verses with its own
  // OpenAI call, and running every book's chapters concurrently would fire
  // the whole corpus at OpenAI at once instead of respecting its rate limits.
  for (const file of files) {
    console.log(file)
    const bibleData = await readBook(path.join(textsPath, file)) // NOSONAR
    await storeBook(client, bibleData, file) // NOSONAR
  }

  // The primary (verse) data is complete regardless of embedding failures, so
  // the marker is written now: a later start serves it immediately instead of
  // redoing the whole import over a handful of chapters. See retryEmbeddings.ts.
  await client.set(IMPORT_COMPLETE_KEY, "1")

  const embeddingFailures = await retryFailedEmbeddings(client)
  if (embeddingFailures > 0) {
    console.warn(
      `WARNING: embeddings are missing for ${embeddingFailures} chapter(s); semantic search misses their verses until a later start re-embeds them.`,
    )
  }

  console.log(`load complete. took ${(Date.now() - start) / 1000}s`)

  return { embeddingFailures }
}
