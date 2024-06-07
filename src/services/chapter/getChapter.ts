import { createClient } from "redis";

export const getChapter = async (bookId: Book['id'], chapterNumber: Chapter['number']): Promise<Chapter> => {
    const client = createClient();
    await client.connect();

    const versesToFetch = await client.keys(`verse:${bookId}:${chapterNumber}:*`)
    const verses: Verse[] = []

    for (let key of versesToFetch) {
        const verse = await client.get(key)

        if (verse) {
            const verseObject: Verse = JSON.parse(verse)
            verses[verseObject.number - 1] = verseObject
        }
    }

    return { bookId, number: chapterNumber, verses }

}