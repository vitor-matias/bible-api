import type { createClient, SearchReply } from "redis"

// Escapes characters that would break out of the quoted phrase in a
// RediSearch query, preventing query injection via user-supplied text.
const escapeSearchPhrase = (text: string): string =>
  text.replace(/[\\"]/g, String.raw`\$&`)

export const searchVerses = async (
  client: ReturnType<typeof createClient>,
  search: string,
  page: number,
  pageSize: number,
): Promise<VersePage> => {
  console.warn(`Searching for: ${search}, page: ${page}, pageSize: ${pageSize}`)

  const offset = (page - 1) * pageSize

  // Add filter for number >= 1 in the RediSearch query
  const results = (await client.ft.SEARCH(
    "idx:verseText",
    `@normalizedText: "${escapeSearchPhrase(search)}" @number:[1 +inf]`,
    {
      LIMIT: {
        from: offset,
        size: pageSize,
      },
      SORTBY: {
        BY: "searchId",
        DIRECTION: "ASC",
      },
    },
  )) as SearchReply

  if (!results) {
    return {
      verses: [],
      total: 0,
      currentPage: page,
      totalPages: 0,
    }
  }

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
