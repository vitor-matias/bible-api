import { Request, Response } from 'express'
import { getChapter } from '../services/chapter/getChapter'


export const getChapterController = async (req: Request, res: Response) => {
    const { book, chapter } = req.params

    const chapterData = await getChapter(book, parseInt(chapter))
    if (chapterData) {
        return res.json(chapterData)
    }

    res.status(404).json({ error: 'Verse not found' })

}