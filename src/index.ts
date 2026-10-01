import * as fs from "node:fs"
import * as path from "node:path"
import cors from "cors"
import express from "express"
import helmet from "helmet"
import { createClient } from "redis"
import setEndpoints from "./rest"
import { generateEmbedding } from "./services/openai/embeddings"
import { readBook } from "./services/usfmImportService/readBook"
import { retryFailedEmbeddings } from "./services/usfmImportService/retryEmbeddings"
import { storeBook } from "./services/usfmImportService/storeBook"
import { EMBEDDING_FAILURES_KEY } from "./services/usfmImportService/storeChapter"
import { verifyEmbeddingIndex } from "./util/embeddingIndex"
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
const IMPORT_COMPLETE_KEY = "importComplete:v3"

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

  // Re-embedding runs after the data is already being served: it is one OpenAI
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

// Loads the Bible data into Redis. Skips re-importing (and the destructive
// flush + costly embedding regeneration) when data is already present, unless
// the process is started with --reimport. Resolves to the state of the
// semantic index; re-embedding failed chapters is left to the caller.
async function loadFilesIntoMemory(): Promise<ImportOutcome> {
  const start = Date.now()
  const reimport = process.argv.includes("--reimport")

  const client = createImportClient()
  await client.connect()
  try {
    // Before anything can be flushed.
    await assertRedisModules(client)

    const alreadyLoaded = (await client.exists(IMPORT_COMPLETE_KEY)) === 1

    if (alreadyLoaded && !reimport) {
      console.info(
        "Bible data already loaded; skipping import. Start with --reimport to force a reload.",
      )
      // Awaited, not returned bare: the finally below would otherwise quit the
      // client before the lookup runs.
      return await existingDataOutcome(client)
    }

    // The flush below is destructive and only embeddings can rebuild what it
    // removes, so find out first, while nothing has been touched, that they
    // can be generated. A missing, rotated or out-of-quota key throws here.
    try {
      await generateEmbedding("ping")
    } catch (error) {
      if (!alreadyLoaded) {
        throw error
      }
      // Complete data is already stored, so refusing the reimport costs
      // nothing; carry on as a start without --reimport would and keep
      // serving it.
      console.error(
        "ERROR: --reimport aborted because embeddings cannot be generated; the existing data is left in place and served. Check OPENAI_API_KEY and restart with --reimport to retry.",
        error,
      )
      return await existingDataOutcome(client)
    }

    const filePath = process.env.PATH_TO_TEXTS as string // Change this to the path of your USFM file
    console.log(filePath)
    // readdirSync order is filesystem-dependent. Sorting keeps book numbering
    // (which feeds searchId) and introduction slug suffixes identical across
    // machines and reimports.
    const files = fs
      .readdirSync(filePath)
      .filter((file) => file.endsWith(".usfm"))
      .sort()

    // An empty or wrongly mounted directory must not be "imported": the flush
    // below would wipe the data and the completion marker would make every
    // later start skip the import even after the mount is fixed.
    if (files.length === 0) {
      const message = `No .usfm files found in PATH_TO_TEXTS (${filePath})`
      if (!alreadyLoaded) {
        throw new Error(message)
      }
      console.error(
        `ERROR: --reimport aborted: ${message}; the existing data is left in place and served.`,
      )
      return await existingDataOutcome(client)
    }

    // flushDatabase also clears any stale completion marker and the record of
    // chapters whose embeddings failed.
    await flushDatabase()

    const chunkSize = 1
    for (let i = 0; i < files.length; i += chunkSize) {
      const chunk = files.slice(i, i + chunkSize)
      await Promise.all(
        chunk.map(async (file) => {
          console.log(file)
          const bibleData = await readBook(path.join(filePath, file))
          await storeBook(client, bibleData, file)
        }),
      )
    }

    // A chapter whose embedding call failed is recorded in Redis rather than
    // blocking the marker: the primary data is complete, and those chapters
    // are re-embedded (now, in the background, and on later starts) instead of
    // flushing and reimporting everything.
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
