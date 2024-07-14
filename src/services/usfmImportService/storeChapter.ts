import { createClient } from "redis"
import { storeVerse } from "./storeVerse"

export const storeChapter = async (client: ReturnType<typeof createClient>, bookCode: string, chapterNumber: number, chapter: USFMChapter): Promise<void> => {
    Object.entries(chapter).forEach(async ([verseNumber, verse]) => {
        if (verseNumber !== 'front') {
            await storeVerse(client, bookCode, chapterNumber, parseInt(verseNumber), verse)
        }
        else {
            await storeVerse(client, bookCode, chapterNumber, 0, verse)
        }
    })
}