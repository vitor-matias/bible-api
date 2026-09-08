import * as fs from "node:fs"
import * as path from "node:path"
import cors from "cors"
import express from "express"
import helmet from "helmet"
import { createClient } from "redis"
import setEndpoints from "./rest"
import { readBook } from "./services/usfmImportService/readBook"
import { storeBook } from "./services/usfmImportService/storeBook"
import { getEmbeddingFailureCount } from "./services/usfmImportService/storeChapter"
import { flushDatabase } from "./util/flushDatabase"
import {
  getImportState,
  isDataAvailable,
  setImportState,
} from "./util/importState"
import { parseTrustProxy } from "./util/trustProxy"

require("dotenv").config()

// Written only after a full import finishes, so a crash mid-import leaves the
// marker absent and the next start reimports instead of serving partial data.
// The suffix is part of the storage format: bump it when the layout changes so
// existing databases reimport instead of being read with the wrong assumptions.
const IMPORT_COMPLETE_KEY = "importComplete:v2"

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

// Always available, so an orchestrator can tell "still importing" from "dead"
// instead of seeing a closed port for the whole import. "degraded" still
// serves: the primary data is complete, only some embeddings are missing.
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

loadFilesIntoMemory()
  .then(() => {
    // Chapters whose embeddings failed are absent from the vector index, so
    // semantic search would silently answer from a partial corpus. Serve the
    // primary data, but mark the process degraded and refuse semantic search.
    setImportState(getEmbeddingFailureCount() > 0 ? "degraded" : "ready")
  })
  .catch((error) => {
    setImportState("failed")
    console.error("Fatal startup error:", error)
  })

// Loads the Bible data into Redis. Skips re-importing (and the destructive
// flush + costly embedding regeneration) when data is already present, unless
// the process is started with --reimport.
async function loadFilesIntoMemory() {
  const start = Date.now()
  const reimport = process.argv.includes("--reimport")

  const client = createClient({
    url: process.env.DB_URL,
    socket: { connectTimeout: 100000 },
  })
  client.on("error", (err) => console.error(`Redis client error: ${err}`))
  await client.connect()
  try {
    const alreadyLoaded = (await client.exists(IMPORT_COMPLETE_KEY)) === 1

    if (alreadyLoaded && !reimport) {
      console.info(
        "Bible data already loaded; skipping import. Start with --reimport to force a reload.",
      )
      return
    }

    // flushDatabase also clears any stale completion marker.
    await flushDatabase()

    const filePath = process.env.PATH_TO_TEXTS as string // Change this to the path of your USFM file
    console.log(filePath)
    // readdirSync order is filesystem-dependent. Sorting keeps book numbering
    // (which feeds searchId) and introduction slug suffixes identical across
    // machines and reimports.
    const files = fs
      .readdirSync(filePath)
      .filter((file) => file.endsWith(".usfm"))
      .sort()

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
  } finally {
    await client.quit()
  }
}
