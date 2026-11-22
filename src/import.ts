import { createClient } from "redis"
import { importBible } from "./services/usfmImportService/importBible"

require("dotenv").config()

// Loads the Bible into the database DB_URL points at, from the USFM files in
// PATH_TO_TEXTS. Run it from a machine that has the texts (`npm run import`)
// when the API itself has none, as on a hosted service. A running API picks the
// data up on its own once the import has finished.
const main = async () => {
  const textsPath = process.env.PATH_TO_TEXTS

  if (!textsPath) {
    console.error("PATH_TO_TEXTS must point at the folder of USFM files.")
    process.exit(1)
  }

  const client = createClient({
    url: process.env.DB_URL,
    socket: { connectTimeout: 100000 },
  })
  client.on("error", (err) => console.error(`Redis client error: ${err}`))
  await client.connect()

  try {
    const { embeddingFailures } = await importBible(client, textsPath)

    if (embeddingFailures > 0) {
      process.exitCode = 1
    }
  } finally {
    await client.quit()
  }
}

main().catch((error) => {
  console.error("Import failed:", error)
  process.exit(1)
})
