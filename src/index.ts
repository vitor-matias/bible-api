import express from 'express'
import { readBook } from './services/usfmImportService/readBook'
import { storeBook } from './services/usfmImportService/storeBook'
import fs from 'fs'
import { flushDatabase } from './util/flushDatabase'
import setEndpoints from './rest'

require('dotenv').config()

const app = express()
const port = process.env.PORT

let filesLoaded: boolean

loadFilesIntoMemory()

// Middleware to load the Bible data into memory
async function loadFilesIntoMemory() {
    if (!filesLoaded) {

        flushDatabase()

        const filePath = process.env.PATH_TO_TEXTS as string // Change this to the path of your USFM file
        console.log(filePath)
        const files = fs.readdirSync(filePath)

        files.forEach(async file => {
            console.log(file)
            const bibleData = await readBook(filePath + file)
            await storeBook(bibleData)
        })

        filesLoaded = true
        console.log("load complete")
    }
}

setEndpoints(app)

// Start the server
app.listen(port, () => {
    console.info(`Server is up and running at http://localhost:${port}`)
})
