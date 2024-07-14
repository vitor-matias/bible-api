import express, { NextFunction, Request, Response } from 'express'
import { getVerseController, getVersesController } from './verses'
import { getBooksController } from './books'
import { getChapterController } from './chapter'
import { createClient } from 'redis'
import { getBookController } from './book'


export default (app: express.Express): void => {
    let client: ReturnType<typeof createClient>

    app.use(async (req, res, next) => {
        if (!client || !client.isReady) {
            client = createClient()
            await client.connect()
        }
        res.locals.client = client
        next()
    })


    const checkCache = async (req: Request, res: Response, next: NextFunction) => {
        const { url } = req
        try {
            const cachedResponse = await client.get(url)
            if (cachedResponse != null) {
                console.log('Cache hit')
                res.send(JSON.parse(cachedResponse))
            } else {
                console.log('Cache miss')

                // Store the original send function
                const originalSend = res.send.bind(res)

                // Override the send function
                res.send = (body) => {
                    // Cache the response
                    client.set(url, JSON.stringify(body)).catch(err => {
                        console.error(`Error setting cache: ${err}`)
                    });

                    client.expire(url, 86400)

                    // Call the original send function
                    return originalSend(body)
                }

                next()
            }
        } catch (error) {
            console.error(`Error in checkCache middleware: ${error}`)
            next()
        }
    }

    // Endpoint to get a specific verse
    app.get('/v1/:book/:chapter/:verse', checkCache, getVerseController)

    // Endpoint to get a specific verse
    app.get('/v1/:book/:chapter/:startVerse/:endVerse', getVersesController)

    app.get('/v1/books', getBooksController)

    app.get('/v1/:book/:chapter', getChapterController)

    app.get('/v1/:book', checkCache, getBookController)


}
