import { createClient } from "redis"
import { getVerse } from "../verse/getVerse"

export const storeVerse = async (client: ReturnType<typeof createClient>, bookId: string, chapterNumber: number, verseNumber: number, verse: USFMVerse): Promise<void> => {
    const verseData: Verse = await getVerse(client, bookId, chapterNumber, verseNumber) || { bookId, chapterNumber, number: verseNumber, text: [] }

    verse.verseObjects.forEach(async (verseObject, i) => {
        if ((verseObject.type === 'text' || verseObject?.tag === 'nd') && verseObject.text) {
            let text = verseObject.text?.replace(/[*\n]/g, '')
            verseData.text.push({
                type: 'text', text
            })
        }
        else if (verseObject.type === 'quote') {
            verseData.text.push({ type: 'quote', text: verseObject.text?.replace(/[*\n]/g, '') ?? '', identLevel: parseInt(verseObject.tag?.split('q')[1] ?? '1') })
        }
        else if (verseObject.type === 'paragraph' && (verseObject.nextChar || verseObject.text)) {
            verseData.text.push({ type: 'paragraph', text: (verseObject.nextChar ?? verseObject.text) ?? '' })
        }
        else if (verseObject.type === 'section') {
            verseData.text.push({ type: 'section', text: verseObject.content?.replace(/[*\n]/g, '') ?? '' })
        }

        else if (verseObject.tag === 'r') {
            verseData.text.push({ type: 'references', text: verseObject.content?.replace(/[*\n]/g, '') ?? '' })
        }
    })
    if (bookId === 'psa' && verseNumber === 0 && chapterNumber === 0) {
        console.error(verseData)
    }
    await client.set(`verse:${bookId}:${chapterNumber}:${verseNumber}`,
        JSON.stringify(
            verseData
        ))

}