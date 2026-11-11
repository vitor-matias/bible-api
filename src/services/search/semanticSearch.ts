import type { createClient, SearchReply } from "redis"
import { EMBEDDING_INDEX } from "../../util/embeddingIndex"
import { jsonMGet } from "../../util/jsonMGet"
import { normalizeText } from "../../util/normalizeText"
import { toFloat32Buffer } from "../../util/vectorBuffer"
import { generateQueryEmbedding } from "../voyage/embeddings"
import { escapeSearchPhrase } from "./searchVerses"

// What the query returns: the verse's key and its cosine distance to the
// query. The vector itself never leaves the index.
type EmbeddingDocument = {
  key: string
  score?: string
}

// A KNN search always answers, nonsense included: "xqzvw" got 100 verses. On
// voyage-context-4 (calibrated Nov 2026 on 64 chapters, 2,075 verses), nonsense
// and off-topic queries peaked at a cosine similarity of 0.10-0.20, real ones
// at 0.24-0.64. Single words overlap the noise ("paz" 0.17, "fé" 0.19), but
// they are in the text, and nonsense isn't: below this similarity a search
// with no word of its own in the Bible answers nothing.
export const MIN_SIMILARITY = 0.22

// Words in every chapter, which tell nothing apart. Others count, however
// short: "fé", "paz", "luz" and "pão" are real searches.
const STOPWORDS = new Set(
  (
    "a ao aos as com como da das de dela dele do dos e ela ele em entre era " +
    "essa esse esta este eu foi ha isso isto ja lhe mais mas me meu minha " +
    "na nao nas no nos o os ou para pela pelo por que quem se sem ser seu " +
    "sua tambem te tem teu tu tua um uma vos"
  ).split(" "),
)

// Whether any of the search's words, stopwords aside, is in a verse, as the
// full-text search would find it.
export const hasWordInText = async (
  client: ReturnType<typeof createClient>,
  search: string,
): Promise<boolean> => {
  const words = new Set(
    normalizeText(search)
      .split(/[^\p{L}]+/u)
      .filter((word) => word.length > 1 && !STOPWORDS.has(word)),
  )
  for (const word of words) {
    const found = (await client.ft.search(
      "idx:verseText",
      `@normalizedText: "${escapeSearchPhrase(word)}" @number:[1 +inf]`,
      { LIMIT: { from: 0, size: 0 } },
    )) as SearchReply
    if (found?.total) return true
  }
  return false
}

// KNN search is capped at this many results; results beyond this offset are unavailable.
export const KNN_MAX_RESULTS = 100

// Contextual embeddings give neighbouring verses similar vectors, so one
// passage could fill a page and push out the same saying elsewhere (a parallel
// Gospel, a quoted Law). At most this many verses per chapter are kept, in
// rank order.
export const MAX_VERSES_PER_CHAPTER = 2

// Neighbours fetched before the chapter cap thins them. Narrative queries
// cluster in a few chapters (300 candidates left as few as 29 results), while
// 1,000 kept the full KNN_MAX_RESULTS window for every query tested and costs
// a few milliseconds more than 100.
const KNN_CANDIDATES = KNN_MAX_RESULTS * 10

// Keeps verse keys in order, dropping any beyond `perChapter` from a chapter
// already represented. A verse key is "verse:<book>:<chapter>:<verse>".
export const capPerChapter = (
  verseKeys: string[],
  perChapter = MAX_VERSES_PER_CHAPTER,
): string[] => {
  const kept = new Map<string, number>()
  return verseKeys.filter((key) => {
    const chapter = key.slice(0, key.lastIndexOf(":"))
    const count = (kept.get(chapter) ?? 0) + 1
    kept.set(chapter, count)
    return count <= perChapter
  })
}

export const semanticSearchVerses = async (
  client: ReturnType<typeof createClient>,
  search: string,
  page: number,
  pageSize: number,
): Promise<VersePage> => {
  const offset = (page - 1) * pageSize

  // Defensive: the controller rejects out-of-window pages with a 400 so this
  // ambiguous zeroed page is unreachable over HTTP, but a direct caller should
  // still not pay for an embedding it cannot use.
  if (offset >= KNN_MAX_RESULTS) {
    return {
      verses: [],
      total: 0,
      currentPage: page,
      totalPages: 0,
    }
  }

  const queryEmbedding = await generateQueryEmbedding(search)
  const embeddingBuffer = toFloat32Buffer(queryEmbedding)

  // Always ask for the full window: a KNN query returns at most K documents, so
  // sizing K to the requested page would make `total` (and therefore
  // `totalPages`) shrink to that page and hide the rest of the results.
  const results = (await client.ft.search(
    EMBEDDING_INDEX,
    `*=>[KNN ${KNN_CANDIDATES} @embedding $vec AS score]`,
    {
      PARAMS: {
        vec: embeddingBuffer,
      },
      LIMIT: {
        from: 0,
        size: KNN_CANDIDATES,
      },
      SORTBY: {
        BY: "score",
        DIRECTION: "ASC",
      },
      RETURN: ["key", "score"],
      DIALECT: 2,
    },
  )) as SearchReply

  if (!results || results.total === 0) {
    return {
      verses: [],
      total: 0,
      currentPage: page,
      totalPages: 0,
    }
  }

  const ranked = results.documents.map(
    (doc) => doc.value as unknown as EmbeddingDocument,
  )

  // The index scores by cosine distance, so similarity is 1 - score.
  const best = 1 - Number(ranked[0]?.score)
  if (best < MIN_SIMILARITY && !(await hasWordInText(client, search))) {
    return {
      verses: [],
      total: 0,
      currentPage: page,
      totalPages: 0,
    }
  }

  // The cap is applied to the whole ranked window before paging, so pages
  // never overlap and `total` counts what can actually be paged through.
  const rankedKeys = capPerChapter(ranked.map((doc) => doc.key)).slice(
    0,
    KNN_MAX_RESULTS,
  )
  const totalResults = rankedKeys.length
  const totalPages = Math.ceil(totalResults / pageSize)

  const verseKeys = rankedKeys.slice(offset, offset + pageSize)

  // One round trip for the whole page.
  const verses = (await jsonMGet<Verse>(client, verseKeys)).filter(
    (verse): verse is Verse => verse != null,
  )

  return {
    verses,
    total: totalResults,
    currentPage: page,
    totalPages,
  }
}
