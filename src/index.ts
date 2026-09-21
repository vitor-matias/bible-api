import cors from "cors"
import express from "express"
import helmet from "helmet"
import { createClient } from "redis"
import setEndpoints from "./rest"
import {
  getSearchIndexStats,
  loadSearchIndex,
} from "./services/search/searchIndex"
import {
  importBible,
  isDataImported,
} from "./services/usfmImportService/importBible"
import { buildHealth, pingDatabase } from "./util/health"
import {
  getImportState,
  type ImportState,
  isDataAvailable,
  setImportState,
} from "./util/importState"
import { getClient, peekClient } from "./util/sharedClient"
import { parseTrustProxy } from "./util/trustProxy"

require("dotenv").config()

const app = express()
app.disable("x-powered-by")
const port = process.env.PORT || "3000"

// Set TRUST_PROXY when running behind a reverse proxy — "true", a hop
// count (e.g. "1"), or a proxy-addr value ("loopback", an IP, a CIDR) —
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

// Makes sure the Bible is in the database, then loads what search needs into
// memory. Skips re-importing (and the destructive flush + costly embedding
// regeneration) when data is already present, unless the process is started
// with --reimport. Resolves to the state the API should report.
async function loadData(): Promise<ImportState> {
  const reimport = process.argv.includes("--reimport")

  const client = createClient({
    url: process.env.DB_URL,
    socket: { connectTimeout: 100000 },
  })
  client.on("error", (err) => console.error(`Redis client error: ${err}`))
  await client.connect()

  try {
    // Chapters whose embeddings failed are absent from the vector index, so
    // semantic search would silently answer from a partial corpus. The primary
    // data is still served, but the process is marked degraded and refuses
    // semantic search.
    let embeddingFailures = 0

    if (reimport || !(await isDataImported(client))) {
      const textsPath = process.env.PATH_TO_TEXTS

      if (textsPath) {
        embeddingFailures = (await importBible(client, textsPath))
          .embeddingFailures
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

    const complete =
      embeddingFailures === 0 && stats.vectors > 0 && stats.skippedVectors === 0
    return complete ? "ready" : "degraded"
  } finally {
    await client.quit()
  }
}
