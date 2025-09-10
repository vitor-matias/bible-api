import * as fs from "node:fs"
import express from "express"
import setEndpoints from "./rest"
import { readBook } from "./services/usfmImportService/readBook"
import { storeBook } from "./services/usfmImportService/storeBook"
import { flushDatabase } from "./util/flushDatabase"

require("dotenv").config()

const app = express()
const port = process.env.PORT

let filesLoaded: boolean

setEndpoints(app)

// Start the server
app.listen(port, () => {
  console.info(`Server is up and running at http://localhost:${port}`)
})

loadFilesIntoMemory()

// Middleware to load the Bible data into memory
async function loadFilesIntoMemory() {
  const start = Date.now()
  if (!filesLoaded) {
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
          const bibleData = await readBook(filePath + file)
          await storeBook(bibleData)
        }),
      )
    }

    filesLoaded = true
    console.log(`load complete. took ${(Date.now() - start) / 1000}s`)
  }
}
