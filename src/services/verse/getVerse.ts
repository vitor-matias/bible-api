import type { createClient } from "redis"

export const getVerse = async (
	client: ReturnType<typeof createClient>,
	bookId: Book["id"],
	chapterNumber: Chapter["number"],
	verseNumber: Verse["number"],
): Promise<Verse> => {
	const verseData = await client.get(
		`verse:${bookId}:${chapterNumber}:${verseNumber}`,
	)

	return verseData ? JSON.parse(verseData) : null
}
