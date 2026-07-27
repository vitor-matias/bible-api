import * as fs from "node:fs"
import * as path from "node:path"
import express from "express"
import { createClient } from "redis"
import setEndpoints from "./rest"
import { readBook } from "./services/usfmImportService/readBook"
import { storeBook } from "./services/usfmImportService/storeBook"
import { flushDatabase } from "./util/flushDatabase"

require("dotenv").config()

const app = express()
app.disable("x-powered-by")
const port = process.env.PORT || "3000"

;(async () => {
  await loadFilesIntoMemory()

  setEndpoints(app)

  // Start the server
  app.listen(port, () => {
    console.info(`Server is up and running at http://localhost:${port}`)
  })
})()

// Loads the Bible data into Redis. Skips re-importing (and the destructive
// flush + costly embedding regeneration) when data is already present, unless
// the process is started with --reimport.
async function loadFilesIntoMemory() {
  const start = Date.now()
  const reimport = process.argv.includes("--reimport")

  const client = createClient({ url: process.env.DB_URL })
  client.on("error", (err) => console.error(`Redis client error: ${err}`))
  await client.connect()
  const alreadyLoaded = (await client.exists("books")) === 1
  await client.quit()

  if (alreadyLoaded && !reimport) {
    console.info(
      "Bible data already loaded; skipping import. Start with --reimport to force a reload.",
    )
    return
  }

  await flushDatabase()

  const filePath = process.env.PATH_TO_TEXTS as string // Change this to the path of your USFM file
  console.log(filePath)
  const files = fs
    .readdirSync(filePath)
    .filter((file) => file.endsWith(".usfm"))

  const chunkSize = 1
  for (let i = 0; i < files.length; i += chunkSize) {
    const chunk = files.slice(i, i + chunkSize)
    await Promise.all(
      chunk.map(async (file) => {
        console.log(file)
        const bibleData = await readBook(path.join(filePath, file))
        await storeBook(bibleData)
      }),
    )
  }

  console.log(`load complete. took ${(Date.now() - start) / 1000}s`)
}
