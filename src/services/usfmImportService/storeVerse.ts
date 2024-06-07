import { createClient } from "redis"

export const storeVerse = async (client: ReturnType<typeof createClient>, bookId: string, chapterNumber: number, verseNumber: number, verse: USFMVerse): Promise<void> => {
    const verseData: Verse = { bookId, chapterNumber, number: verseNumber, text: '' }
    verse.verseObjects.forEach(async verseObject => {
        if ((verseObject.type === 'text' || verseObject?.tag === 'nd' || verseObject.type === 'quote') && verseObject.text) {

            if (verseObject.type === 'quote') {
                verseData.text += '\n'
            }

            verseData.text += verseObject.text?.replace(/[*\n]/g, '')

        }
        else if (verseObject.type === 'paragraph') {
            verseData.paragraph = verseObject.nextChar || verseObject.text
        }
        else if (verseObject.type === 'section') {
            verseData.section = { text: verseObject.content?.replace(/[*\n]/g, '') ?? '' }
        }
    })

    await client.set(`verse:${bookId}:${chapterNumber}:${verseNumber}`,
        JSON.stringify(
            verseData
        ))

}