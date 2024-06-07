import { createClient } from "redis"

export const storeVerse = async (client: ReturnType<typeof createClient>, bookId: string, chapterNumber: number, verseNumber: number, verse: USFMVerse): Promise<void> => {
    const verseData: Verse = { bookId, chapterNumber, number: verseNumber, text: [] }
    verse.verseObjects.forEach(async verseObject => {
        if ((verseObject.type === 'text' || verseObject?.tag === 'nd') && verseObject.text) {
            verseData.text.push({ type: 'text', text: verseObject.text?.replace(/[*\n]/g, '') })
        }
        else if (verseObject.type === 'quote') {
            verseData.text.push({ type: 'quote', text: verseObject.text ?? '' })
        }
        else if (verseObject.type === 'paragraph' && (verseObject.nextChar || verseObject.text)) {
            verseData.text.push({ type: 'paragraph', text: (verseObject.nextChar ?? verseObject.text) ?? '' })
        }
        else if (verseObject.type === 'section') {
            verseData.text.push({ type: 'section', text: verseObject.content?.replace(/[*\n]/g, '') ?? '' })
        }
    })

    await client.set(`verse:${bookId}:${chapterNumber}:${verseNumber}`,
        JSON.stringify(
            verseData
        ))

}