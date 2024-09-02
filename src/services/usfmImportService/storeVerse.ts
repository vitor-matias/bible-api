import type { createClient } from "redis"
import { getVerse } from "../verse/getVerse"

export const storeVerse = async (
	client: ReturnType<typeof createClient>,
	bookId: string,
	chapterNumber: number,
	verseNumber: number,
	verseLabel: string,
	verseObjects: USFMVerseObject[],
): Promise<void> => {
	const verseData: Verse = (await getVerse(
		client,
		bookId,
		chapterNumber,
		verseNumber,
	)) || { bookId, chapterNumber, number: verseNumber, text: [], verseLabel }

	verseObjects.forEach(async (verseObject, i) => {
		if (
			(verseObject.type === "text" || verseObject?.tag === "nd") &&
			verseObject.text
		) {
			const text = verseObject.text?.replace(/[*\n]/g, "")
			verseData.text.push({
				type: "text",
				text,
			})
		} else if (verseObject.type === "quote") {
			verseData.text.push({
				type: "quote",
				text: verseObject.text?.replace(/[*\n]/g, "") ?? "",
				identLevel: Number.parseInt(verseObject.tag?.split("q")[1] ?? "1"),
			})
		} else if (
			verseObject.type === "paragraph" &&
			(verseObject.nextChar || verseObject.text)
		) {
			verseData.text.push({
				type: "paragraph",
				text: verseObject.nextChar ?? verseObject.text ?? "",
			})
		} else if (verseObject.type === "section" || verseObject.tag === 'ms') {
			verseData.text.push({
				type: "section",
				tag: verseObject.tag ?? "s2",
				text: verseObject.content?.replace(/[*\n]/g, "") ?? "",
			})
		} else if (verseObject.tag === "r") {
			verseData.text.push({
				type: "references",
				text: verseObject.content?.replace(/[*\n]/g, "") ?? "",
			})
		}
	})

	await client.set(
		`verse:${bookId}:${chapterNumber}:${verseNumber}`,
		JSON.stringify(verseData),
	)
}
