import { createClient } from "redis";

export const getVerse = async (bookId: Book['id'], chapterNumber: Chapter['number'], verseNumber: Verse['number']): Promise<Verse> => {
    const client = createClient()
    await client.connect()

    const verseData = await client.get(`verse:${bookId}:${chapterNumber}:${verseNumber}`)

    await client.quit()

    return verseData ? JSON.parse(verseData) : null
}