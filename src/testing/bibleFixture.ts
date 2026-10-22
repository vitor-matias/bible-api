import { chapterTitleKey } from "../services/chapter/getBookChapterTitle"
import { chapterVerseMaxKey } from "../services/chapter/verseCountKey"
import { verseKey } from "../services/verse/getVerse"
import { createFakeRedis } from "./fakeRedis"

export const verse = (
  bookId: string,
  chapterNumber: number,
  number: number,
): Verse => ({
  bookId,
  chapterNumber,
  number,
  numberLabel: String(number),
  searchId: `01-${chapterNumber}-${number}`,
  text: [{ type: "text", text: `v${number}`, normalizedText: `v${number}` }],
})

// A fake Redis holding Genesis as the import would store it: chapter 1 with
// the "front" verse 0 and verses 1-3, chapter 2 with verses 1-2 and no verse
// 0, and chapter 3 listed in chapterCount but never stored.
export const fakeBible = async () => {
  const fake = createFakeRedis()
  const { client } = fake

  await client.rPush("books", "gen")
  await client.json.set("book:gen", "$", {
    id: "gen",
    name: "Génesis",
    shortName: "Gn",
    abrv: "Gn",
    chapterCount: 3,
  })

  for (const [chapter, numbers] of [
    [1, [0, 1, 2, 3]],
    [2, [1, 2]],
  ] as const) {
    for (const number of numbers) {
      await client.json.set(
        verseKey("gen", chapter, number),
        "$",
        verse("gen", chapter, number),
      )
    }
    await client.set(
      chapterVerseMaxKey("gen", chapter),
      String(numbers[numbers.length - 1]),
    )
  }
  await client.set(chapterTitleKey("gen", 1), "A criação")

  return fake
}
