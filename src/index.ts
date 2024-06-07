import express from 'express'
import { readBook } from './services/usfmImportService/readBook'
import { storeBook } from './services/usfmImportService/storeBook'
import fs from 'fs'
import { flushDatabase } from './util/flushDatabase'
import setEndpoints from './rest'


const app = express()
const port = 3000

let filesLoaded: boolean

loadFilesIntoMemory()

// Middleware to load the Bible data into memory
async function loadFilesIntoMemory() {
    if (!filesLoaded) {

        flushDatabase()

        const filePath = '../portuguese-capuchine-translation/usfm-nv/' // Change this to the path of your USFM file

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
