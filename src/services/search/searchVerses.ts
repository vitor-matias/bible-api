import type { createClient } from "redis"
import { mGetJson } from "../../util/jsonStore"
import { findPhrase, getTextIndex } from "./searchIndex"

// `search` must already be normalized (lowercase, accents removed); see
// normalizeText. Matches are verses containing it as an exact phrase of whole
// words, in verse order.
export const searchVerses = async (
  client: ReturnType<typeof createClient>,
  search: string,
  page: number,
  pageSize: number,
): Promise<VersePage> => {
  const offset = (page - 1) * pageSize

  const { keys, total } = findPhrase(getTextIndex(), search, offset, pageSize)
  const totalPages = Math.ceil(total / pageSize)

  if (page > totalPages) {
    return {
      verses: [],
      total,
      currentPage: page,
      totalPages,
    }
  }

  const verses: Verse[] = []
  for (const verse of await mGetJson<Verse>(client, keys)) {
    if (verse) {
      verses.push(verse)
    }
  }

  return {
    verses,
    total,
    currentPage: page,
    totalPages,
  }
}
