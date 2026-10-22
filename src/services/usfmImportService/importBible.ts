import * as path from "node:path"
import type { createClient } from "redis"
import { createTaskPool } from "../../util/concurrency"
import { flushDatabase } from "../../util/flushDatabase"
import { generateQueryEmbedding } from "../voyage/embeddings"
import { IMPORT_COMPLETE_KEY } from "./importMarker"
import { listUsfmFiles } from "./listUsfmFiles"
import { readBook } from "./readBook"
import { retryFailedEmbeddings } from "./retryEmbeddings"
import { storeBook } from "./storeBook"

type Client = ReturnType<typeof createClient>

// How many chapters' embedding requests may be in flight at once. The API's
// per-minute request limit is enforced in the Voyage client
// (services/voyage/embeddings.ts), where retries count too.
const EMBEDDING_CONCURRENCY = 16

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

  // The import deletes everything before it embeds anything, so confirm Voyage
  // answers first: a missing, rotated or out-of-quota key then fails while any
  // old data still serves.
  await generateQueryEmbedding("ping")

  // flushDatabase also clears any stale completion marker and the record of
  // chapters whose embeddings failed.
  await flushDatabase()

  console.log(textsPath)

  // Each chapter's embedding call runs in the pool, behind the storing of the
  // chapters that follow it, instead of the import waiting on the API for every
  // one in turn.
  const embeddings = createTaskPool(EMBEDDING_CONCURRENCY)

  try {
    // One book at a time, in file order: a book's position in the "books" list
    // numbers its verses, so storing them out of order would renumber them.
    for (const file of files) {
      console.log(file)
      const bibleData = await readBook(path.join(textsPath, file)) // NOSONAR
      await storeBook(client, bibleData, file, embeddings) // NOSONAR
    }
  } catch (error) {
    // Let the embedding calls already in flight settle before the caller closes
    // the client under them; the storage error is the one worth reporting.
    await embeddings.drain().catch(() => {})
    throw error
  }

  // Every chapter's embedding has to have landed, or been recorded as failed,
  // before the marker is written and the failure set is read below.
  await embeddings.drain()

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
