import type { createClient, SearchReply } from "redis"

export const searchVerses = async (
  client: ReturnType<typeof createClient>,
  search: string,
  page: number,
  pageSize: number,
): Promise<VersePage> => {
  const offset = (page - 1) * pageSize

  // `search` must already be sanitized (see sanitizeSearchQuery) so it cannot
  // escape the quoted phrase or inject RediSearch query syntax.
  const results = (await client.ft.SEARCH(
    "idx:verseText",
    `@normalizedText: "${search}" @number:[1 +inf]`,
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

  return {
    verses: results.documents.map(
      (document) => document.value as unknown as Verse,
    ),
    total: results.total,
    currentPage: page,
    totalPages,
  }
}
