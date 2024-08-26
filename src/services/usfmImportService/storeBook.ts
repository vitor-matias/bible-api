import { createClient } from "redis"
import { getBookHeader } from "../book/getBookHeader"
import { getBookId } from "../book/getBookId"
import { storeChapter } from "./storeChapter"

export const storeBook = async (usfmBook: USFMBook): Promise<void> => {
	const bookId = getBookId(usfmBook)?.toLowerCase()

	if (bookId) {
		const client = createClient()
		await client.connect()

		await client.rPush("books", bookId)

		const bookName = getBookHeader(usfmBook, "toc1")
		const bookShortName = getBookHeader(usfmBook, "toc2")
		const bookAbrv = getBookHeader(usfmBook, "toc3")

		const book: Book = {
			id: bookId,
			name: bookName ?? "",
			shortName: bookShortName ?? "",
			abrv: bookAbrv ?? "",
			chapterCount: Object.keys(usfmBook.chapters).length,
		}

		await client.set(`book:${bookId}`, JSON.stringify(book))

		for (const [number, chapter] of Object.entries(usfmBook.chapters)) {
			await storeChapter(client, bookId, Number.parseInt(number), chapter)
		}
	}
}
