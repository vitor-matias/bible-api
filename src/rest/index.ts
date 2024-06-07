import express from 'express'
import { getVerseController, getVersesController } from './verses'
import { getBooksController } from './books'
import { getChapterController } from './chapter'


export default (app: express.Express): void => {
    // Endpoint to get a specific verse
    app.get('/v1/:book/:chapter/:verse', getVerseController)

    // Endpoint to get a specific verse
    app.get('/v1/:book/:chapter/:startVerse/:endVerse', getVersesController)

    app.get('/v1/books', getBooksController)

    app.get('/v1/:book/:chapter', getChapterController)
}
