import { createClient } from "redis"

export const getChapter = async (client: ReturnType<typeof createClient>, bookId: Book['id'], chapterNumber: Chapter['number']): Promise<Chapter> => {

    const versesToFetch = await client.keys(`verse:${bookId}:${chapterNumber}:*`)
    const verses: Verse[] = []

    for (let key of versesToFetch) {
        const verse = await client.get(key)

        if (verse) {
            const verseObject: Verse = JSON.parse(verse)
            verses[verseObject.number] = verseObject
        }
    }

    return { bookId, number: chapterNumber, verses }

}