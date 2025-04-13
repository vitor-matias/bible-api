import type { createClient } from "redis"

export const searchVerses = async (
  client: ReturnType<typeof createClient>,
  search: string,
  page: number,
): Promise<VersePage> => {
  console.warn(`Searching for: ${search}`)

  const pageSize = 10
  const offset = page * pageSize

  const results = await client.ft.search("idx:verseText", `@text: ${search}`, {
    LIMIT: {
      from: offset,
      size: pageSize,
    },
  })

  const totalPages = Math.ceil(results.total / pageSize)

  if (page > totalPages) {
    return {
      verses: [],
      total: results.total,
      currentPage: page,
      totalPages: totalPages,
    }
  }

  console.warn(`Found ${results.total} results (page ${page}/${totalPages})`)

  return {
    verses: results.documents.map(
      (document) => document.value as unknown as Verse,
    ),
    total: results.total,
    currentPage: page,
    totalPages,
  }
}
