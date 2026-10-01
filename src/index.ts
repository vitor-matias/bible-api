import cors from "cors"
import express from "express"
import helmet from "helmet"
import { createClient } from "redis"
import setEndpoints from "./rest"
import {
  getSearchIndexStats,
  loadSearchIndex,
} from "./services/search/searchIndex"
import { importBible } from "./services/usfmImportService/importBible"
import { isDataImported } from "./services/usfmImportService/importMarker"
import { retryFailedEmbeddings } from "./services/usfmImportService/retryEmbeddings"
import { EMBEDDING_FAILURES_KEY } from "./services/usfmImportService/storeChapter"
import { buildHealth, pingDatabase } from "./util/health"
import {
  getImportState,
  type ImportState,
  isDataAvailable,
  setImportState,
  stateAfterLoad,
} from "./util/importState"
import { getClient, peekClient } from "./util/sharedClient"
import { parseTrustProxy } from "./util/trustProxy"

require("dotenv").config()

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

// Always answers, so an orchestrator can tell "still loading" from "dead"
// instead of seeing a closed port for the whole import. Healthy (200) only when
// the data is loaded and the database answers a PING; see buildHealth. It uses
// the connection that already exists and never waits for one, so it stays fast
// (Render allows five seconds) even while the database is down.
app.get("/health", async (_req, res) => {
  const database = await pingDatabase(peekClient())
  const { code, body } = buildHealth(
    getImportState(),
    database,
    getSearchIndexStats(),
  )
  res.status(code).json(body)
})

// Refuse data requests until the data is loaded, so partially loaded data is
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

// Open the shared database connection now instead of on the first data request,
// so the health check can tell a database that is up from one that is not.
getClient().catch((error) =>
  console.error("Could not connect to the database:", error),
)

// Listen before the data is loaded: a first import can take many minutes, and a
// closed port makes health checks fail and the container restart from scratch.
app.listen(port, () => {
  console.info(`Server is up and running at http://localhost:${port}`)
})

loadData()
  .then(setImportState)
  .catch((error) => {
    setImportState("failed")
    console.error("Fatal startup error:", error)
  })

// How often a process with no texts of its own looks for an import to finish.
const IMPORT_POLL_MS = 15_000

const waitForImport = async (
  client: ReturnType<typeof createClient>,
): Promise<void> => {
  while (!(await isDataImported(client))) {
    await new Promise((resolve) => setTimeout(resolve, IMPORT_POLL_MS))
  }
}

// A plain function declaration, not `const`: loadData() below is invoked at
// the top of the module, synchronously, before a `const` here would be
// initialized (loadData itself is a hoisted function declaration, so calling
// it early is fine; a same-scope `const` it immediately depends on is not).
function createDbClient() {
  const client = createClient({
    url: process.env.DB_URL,
    socket: { connectTimeout: 100000 },
  })
  client.on("error", (err) => console.error(`Redis client error: ${err}`))
  return client
}

// Makes sure the Bible is in the database, then loads what search needs into
// memory. Skips re-importing (and the destructive flush + costly embedding
// regeneration) when data is already present, unless the process is started
// with --reimport. Resolves to the state the API should report right away: a
// chapter still recorded as failed does not hold this up (see
// retryEmbeddingsInBackground below) — re-embedding can mean one OpenAI call
// per failed chapter, and an outage during the import can leave hundreds of
// them, which would otherwise be minutes of 503s on every single start.
async function loadData(): Promise<ImportState> {
  const reimport = process.argv.includes("--reimport")

  const client = createDbClient()
  await client.connect()

  try {
    if (reimport || !(await isDataImported(client))) {
      const textsPath = process.env.PATH_TO_TEXTS

      if (textsPath) {
        await importBible(client, textsPath)
      } else if (reimport) {
        throw new Error("--reimport needs PATH_TO_TEXTS to read the texts from")
      } else {
        // A hosted instance usually has no texts on disk. It stays up, reports
        // "loading", and picks the data up once `npm run import` has filled the
        // database it points at.
        console.warn(
          "No Bible data in the database and PATH_TO_TEXTS is not set, so this process cannot import it. Run `npm run import` against this database; the data is loaded here as soon as it appears.",
        )
        await waitForImport(client)
      }
    } else {
      console.info(
        "Bible data already loaded; skipping import. Start with --reimport to force a reload.",
      )
    }

    const stats = await loadSearchIndex(client)
    const skipped =
      stats.skippedVectors > 0
        ? `, ${stats.skippedVectors} unreadable vectors skipped`
        : ""
    console.info(
      `Search index loaded: ${stats.verses} verses, ${stats.vectors} vectors${skipped}.`,
    )

    if (stats.verses === 0) {
      console.error(
        "The database holds no readable verses. Run `npm run import` with the USFM texts, then restart the API.",
      )
    }

    // Chapters whose embeddings failed are recorded in Redis rather than held
    // in memory, so every start sees them, not just the one that hit the
    // failure — but only the background retry below acts on it; serving the
    // primary data never waits for that.
    const embeddingFailures = await client.sCard(EMBEDDING_FAILURES_KEY)
    const state = stateAfterLoad(embeddingFailures, stats)

    if (state === "degraded" && embeddingFailures > 0) {
      // Fire-and-forget: it handles its own errors and never blocks the state
      // this function is about to return.
      void retryEmbeddingsInBackground()
    }

    return state
  } finally {
    await client.quit()
  }
}

// Re-embeds the chapters recorded as failed, outside the startup path, and
// reloads the search index so the new vectors become searchable, lifting the
// process out of "degraded" once none remain. Never throws: a start that is
// still degraded afterwards is retried again on the next restart.
async function retryEmbeddingsInBackground(): Promise<void> {
  const client = createDbClient()
  await client.connect()

  try {
    const missingEmbeddings = await retryFailedEmbeddings(client)
    if (missingEmbeddings > 0) {
      console.warn(
        `WARNING: embeddings are still missing for ${missingEmbeddings} chapter(s); semantic search misses their verses until a later retry.`,
      )
      return
    }

    const stats = await loadSearchIndex(client)
    console.info(
      `Search index reloaded after retrying embeddings: ${stats.verses} verses, ${stats.vectors} vectors.`,
    )
    setImportState(stateAfterLoad(0, stats))
  } catch (error) {
    console.error("Background re-embedding failed:", error)
  } finally {
    await client.quit()
  }
}
