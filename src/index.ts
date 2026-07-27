import "dotenv/config"
import * as fs from "node:fs"
import * as path from "node:path"
import cors from "cors"
import express from "express"
import helmet from "helmet"
import { createClient } from "redis"
import setEndpoints from "./rest"
import { readBook } from "./services/usfmImportService/readBook"
import { storeBook } from "./services/usfmImportService/storeBook"
import { flushDatabase } from "./util/flushDatabase"

const app = express()
const port = Number.parseInt(process.env.PORT ?? "", 10) || 3000

// Set TRUST_PROXY when running behind a reverse proxy (e.g. "1" or "loopback"),
// otherwise rate limiting keys on the proxy address instead of the client.
const trustProxy = process.env.TRUST_PROXY
if (trustProxy) {
  app.set(
    "trust proxy",
    Number.isNaN(Number(trustProxy)) ? trustProxy : Number(trustProxy),
  )
}

app.use(helmet())

// Public read-only API: allow any origin unless CORS_ORIGIN restricts it
// (comma-separated list of allowed origins)
const corsOrigin = process.env.CORS_ORIGIN
app.use(cors({ origin: corsOrigin ? corsOrigin.split(",") : "*" }))

const client = createClient({ url: process.env.DB_URL })
client.on("error", (error) => {
  console.error("Redis client error:", error)
})

async function main() {
  await client.connect()

  // Load data before accepting traffic so incomplete responses never get cached
  await loadFilesIntoMemory()

  setEndpoints(app, client)

  app.listen(port, () => {
    console.info(`Server is up and running at http://localhost:${port}`)
  })
}

// Load the Bible data into the database
async function loadFilesIntoMemory() {
  const start = Date.now()

  await flushDatabase(client)

  const textsPath = process.env.PATH_TO_TEXTS
  if (!textsPath) {
    throw new Error("PATH_TO_TEXTS environment variable is not set")
  }

  // Sorted so book order (and book numbers) stay deterministic
  const files = fs
    .readdirSync(textsPath)
    .filter((file) => file.endsWith(".usfm"))
    .sort()

  for (const file of files) {
    const bibleData = await readBook(path.join(textsPath, file))
    await storeBook(client, bibleData)
  }

  console.info(`load complete. took ${(Date.now() - start) / 1000}s`)
}

main().catch((error) => {
  console.error("Fatal startup error:", error)
  process.exit(1)
})
