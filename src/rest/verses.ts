import { Request, Response } from 'express'
import { getVerse } from "../services/verse/getVerse";


export const getVerseController = async (req: Request, res: Response) => {
    const { book, chapter, verse } = req.params

    const { client } = res.locals

    const verseData = await getVerse(client, book, parseInt(chapter), parseInt(verse))
    if (verseData) {
        return res.json(verseData)
    }

    res.status(404).json({ error: 'Verse not found' })
}

export const getVersesController = async (req: Request, res: Response) => {
    const { book, chapter, startVerse, endVerse } = req.params
    const { client } = res.locals

    if (parseInt(startVerse) > parseInt(endVerse)) {

        let currentVerse = parseInt(startVerse)

        const verseData = []

        while (currentVerse <= parseInt(endVerse)) {
            const data = await getVerse(client, book, parseInt(chapter), currentVerse)

            if (!data) {
                break
            }

            verseData.push(data)

            currentVerse++
        }


        if (verseData) {
            return res.json(verseData)
        }

    }


    res.status(404).json({ error: 'Verse not found' })
}