import { createClient } from "redis"

export const storeVerse = async (client: ReturnType<typeof createClient>, bookId: string, chapterNumber: number, verseNumber: number, verse: USFMVerse): Promise<void> => {
    const verseData: Verse = { bookId, chapterNumber, number: verseNumber, text: [] }
    verse.verseObjects.forEach(async (verseObject, i) => {
        if ((verseObject.type === 'text' || verseObject?.tag === 'nd') && verseObject.text) {
            let text = verseObject.text?.replace(/[*\n]/g, '')
            verseData.text.push({
                type: 'text', text
            })
        }
        else if (verseObject.type === 'quote') {
            if (verseData.text.length > 0) {
                verseData.text[verseData.text.length - 1].text += '\n'
            }

            verseData.text.push({ type: 'quote', text: verseObject.text?.replace(/[*\n]/g, '') ?? '' })
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