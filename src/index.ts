import * as path from "node:path"
import cors from "cors"
import express from "express"
import helmet from "helmet"
import { createClient } from "redis"
import setEndpoints from "./rest"
import { readBook } from "./services/usfmImportService/readBook"
import { retryFailedEmbeddings } from "./services/usfmImportService/retryEmbeddings"
import { storeBook } from "./services/usfmImportService/storeBook"
import { EMBEDDING_FAILURES_KEY } from "./services/usfmImportService/storeChapter"
import { generateQueryEmbedding } from "./services/voyage/embeddings"
import { createTaskPool } from "./util/concurrency"
import { verifyEmbeddingIndex } from "./util/embeddingIndex"
import { checkSourceFiles, FILE_HASHES_KEY } from "./util/fileHashes"
import { flushDatabase } from "./util/flushDatabase"
import {
  getImportState,
  isDataAvailable,
  setImportState,
} from "./util/importState"
import { assertRedisModules } from "./util/requireRedisModules"
import { parseTrustProxy } from "./util/trustProxy"

require("dotenv").config()

// Written only after a full import finishes, so a crash mid-import leaves the
// marker absent and the next start reimports instead of serving partial data.
// Chapters whose embeddings failed do not hold it back; see loadFilesIntoMemory.
// The suffix is part of the storage format: bump it when the layout changes so
// existing databases reimport instead of being read with the wrong assumptions.
const IMPORT_COMPLETE_KEY = "importComplete:v5"

// The import embeds each chapter in its own request, in the background, with
// at most 16 in flight. The API's per-minute request limit is enforced in the
// Voyage client (services/voyage/embeddings.ts), where retries count too.
const EMBEDDING_CONCURRENCY = 16

const app = express()
app.disable("x-powered-by")
const port = process.env.PORT || "3000"

// Set TRUST_PROXY when running behind a reverse proxy — a hop count (e.g.
// "1") or a proxy-addr value ("loopback", an IP, a CIDR); "true" is rejected
// because it trusts every X-Forwarded-For entry —
// otherwise rate limiting keys on the proxy address instead of the client.
// parseTrustProxy rejects values Express would misread; see its comment.
const trustProxy = process.env.TRUST_PROXY
if (trustProxy) {
  app.set("trust proxy", parseTrustProxy(trustProxy))
}

// helmet's defaults target HTML apps: they set a CSP built around 'self'
// script/style/img sources and Cross-Origin-Resource-Policy: same-origin, which
// contradicts the open CORS policy below and refuses no-cors consumers of a
// public read-only JSON API. This API serves no markup and loads no
// subresources, so the strictest possible policy applies instead of the
// HTML-shaped default.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        "default-src": ["'none'"],
        "frame-ancestors": ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
)

// Public read-only API: allow any origin unless CORS_ORIGIN restricts it
// (comma-separated list of allowed origins)
const allowedOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin !== "")

// An empty list would tell cors to match no origin at all, so a stray comma in
// CORS_ORIGIN would silently break every browser client. Treat it as unset.
app.use(cors({ origin: allowedOrigins.length > 0 ? allowedOrigins : "*" }))

// Always available, so an orchestrator can tell "still importing" from "dead"
// instead of seeing a closed port for the whole import. "degraded" still
// serves: the primary data is complete, only semantic search is unavailable.
app.get("/health", (_req, res) => {
  res.status(isDataAvailable() ? 200 : 503).json({ status: getImportState() })
})

// Refuse data requests until the import finishes, so partially loaded data is
// never served.
app.use((_req, res, next) => {
  if (!isDataAvailable()) {
    return res.status(503).json({
      error: "Bible data is not available yet",
      status: getImportState(),
    })
  }
  next()
})

setEndpoints(app)

// Listen before the import runs: it can take many minutes, and a closed port
// makes health checks fail and the container restart from scratch.
app.listen(port, () => {
  console.info(`Server is up and running at http://localhost:${port}`)
})

// What the import leaves behind. Anything short of "complete" still serves the
// primary data, which is whole in every case; only semantic search waits.
type ImportOutcome = "complete" | "embeddingsPending" | "indexIncomplete"

// Never rejects: an import failure is recorded in the import state, and a
// failed background re-embed only leaves semantic search disabled.
const startImport = async (): Promise<void> => {
  let outcome: ImportOutcome
  try {
    outcome = await loadFilesIntoMemory()
  } catch (error) {
    setImportState("failed")
    console.error("Fatal startup error:", error)
    return
  }

  if (outcome === "complete") {
    setImportState("ready")
    return
  }

  // Chapters whose embeddings failed are absent from the vector index, so
  // semantic search would silently answer from a partial corpus. Serve the
  // primary data, but mark the process degraded and refuse semantic search.
  setImportState("degraded")

  // Re-embedding runs after the data is already being served: it is one Voyage
  // call per failed chapter, and an outage during the import can leave
  // hundreds of them — minutes of 503s if the start waited for it.
  if (outcome === "embeddingsPending") {
    try {
      await reembedFailedChapters()
    } catch (error) {
      console.error("Re-embedding failed chapters failed:", error)
    }
  }
}

// startImport handles its own errors, so nothing is left to catch here.
void startImport()

function createImportClient() {
  const client = createClient({
    url: process.env.DB_URL,
    socket: { connectTimeout: 100000 },
  })
  client.on("error", (err) => console.error(`Redis client error: ${err}`))
  return client
}

// Outcome for data that is already stored and is being kept as is.
async function existingDataOutcome(
  client: ReturnType<typeof createClient>,
): Promise<ImportOutcome> {
  return (await client.sCard(EMBEDDING_FAILURES_KEY)) > 0
    ? "embeddingsPending"
    : "complete"
}

// A stored vector the index skipped raises no error of its own, so the index is
// checked against the stored vectors. Retrying chapters cannot repair a skipped
// vector, so on a shortfall the completion marker is dropped: the next start
// reimports instead of serving a partial index as complete.
async function verifyIndexOrInvalidate(
  client: ReturnType<typeof createClient>,
): Promise<boolean> {
  try {
    await verifyEmbeddingIndex(client)
    return true
  } catch (error) {
    await client.del(IMPORT_COMPLETE_KEY)
    console.warn(
      `WARNING: the embedding index is incomplete, so the import is not marked complete and the next start will reimport: ${error}`,
    )
    return false
  }
}

// Re-embeds the chapters recorded as failed and, once none are left and the
// index checks out, lifts the degraded state.
async function reembedFailedChapters(): Promise<void> {
  const client = createImportClient()
  await client.connect()
  try {
    const missingEmbeddings = await retryFailedEmbeddings(client)
    if (missingEmbeddings > 0) {
      console.warn(
        `WARNING: embeddings are missing for ${missingEmbeddings} chapter(s); semantic search is disabled until the next start re-embeds them.`,
      )
      return
    }

    if (await verifyIndexOrInvalidate(client)) {
      setImportState("ready")
    }
  } finally {
    await client.quit()
  }
}

// Loads the Bible data into Redis. Skips the destructive flush and costly
// embedding regeneration when data is already stored and the source files hash
// as they did then, unless started with --reimport. Resolves to the state of
// the semantic index; re-embedding failed chapters is left to the caller.
async function loadFilesIntoMemory(): Promise<ImportOutcome> {
  const start = Date.now()
  const filePath = process.env.PATH_TO_TEXTS as string

  const client = createImportClient()
  await client.connect()
  try {
    // Before anything can be flushed.
    await assertRedisModules(client)

    const alreadyLoaded = (await client.exists(IMPORT_COMPLETE_KEY)) === 1

    // Nothing is touched before these checks pass. With complete data already
    // stored, refusing the import costs nothing, so it is kept and served.
    const abort = async (reason: string, error?: unknown) => {
      if (!alreadyLoaded) throw error ?? new Error(reason)
      console.error(
        `ERROR: import skipped: ${reason}; the existing data is left in place and served.`,
        ...(error ? [error] : []),
      )
      // Awaited, not returned bare: the finally below would otherwise quit
      // the client before the lookup runs.
      return await existingDataOutcome(client)
    }

    const source = checkSourceFiles(
      filePath,
      alreadyLoaded && !process.argv.includes("--reimport")
        ? await client.hGetAll(FILE_HASHES_KEY)
        : undefined,
    )
    if (source.action === "abort") {
      return await abort(source.reason, source.error)
    }
    if (source.action === "skip") {
      console.info(
        "Bible data already loaded; skipping import. Start with --reimport to force a reload.",
      )
      return await existingDataOutcome(client)
    }
    if (source.message) console.info(source.message)
    const { files, fileHashes } = source

    // Only embeddings can rebuild what the flush removes, so check they can be
    // generated. A missing, rotated or out-of-quota key throws here.
    try {
      await generateQueryEmbedding("ping")
    } catch (error) {
      return await abort(
        "embeddings cannot be generated (check VOYAGE_API_KEY, then restart to retry)",
        error,
      )
    }

    // flushDatabase also clears any stale completion marker and the record of
    // chapters whose embeddings failed.
    await flushDatabase()

    // Books are stored one at a time, in order (their position numbers the
    // verses), while chapter embedding calls run behind them in the pool.
    const embeddings = createTaskPool(EMBEDDING_CONCURRENCY)
    try {
      // Sequential on purpose: each book's position in the "books" list
      // numbers its verses, so books must be stored in file order.
      for (const file of files) {
        console.log(file)
        const bibleData = await readBook(path.join(filePath, file))
        await storeBook(client, bibleData, file, embeddings) // NOSONAR
      }
    } catch (error) {
      // Let in-flight embedding calls settle before the client is closed
      // under them; the storage error is the one worth reporting.
      await embeddings.drain().catch(() => {})
      throw error
    }
    // Every chapter's embedding must have landed (or been recorded as failed)
    // before the failure set is read below.
    await embeddings.drain()

    // A chapter whose embedding call failed is recorded in Redis rather than
    // blocking the marker: the primary data is complete, and those chapters
    // are re-embedded (now, in the background, and on later starts) instead of
    // flushing and reimporting everything. The hashes go in first: a crash
    // between the two writes leaves no marker, so the next start reimports.
    await client.hSet(FILE_HASHES_KEY, fileHashes)
    await client.set(IMPORT_COMPLETE_KEY, "1")

    console.log(`load complete. took ${(Date.now() - start) / 1000}s`)

    if ((await client.sCard(EMBEDDING_FAILURES_KEY)) > 0) {
      return "embeddingsPending"
    }
    return (await verifyIndexOrInvalidate(client))
      ? "complete"
      : "indexIncomplete"
  } finally {
    await client.quit()
  }
}
