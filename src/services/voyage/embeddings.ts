import { VoyageAIClient } from "voyageai"
import { createRateLimiter } from "../../util/concurrency"
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "../../util/vectorBuffer"

// Model API keys created in MongoDB Atlas are served from ai.mongodb.com. A key
// from the Voyage AI platform, or one scoped to a geography, needs its own
// endpoint, which VOYAGE_BASE_URL sets.
const DEFAULT_BASE_URL = "https://ai.mongodb.com/v1"

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

// The SDK sends the API key as a Bearer header to whatever URL it is given, so
// an override must use HTTPS. Plain HTTP is accepted only for a loopback host
// (a local stub), where the request never leaves the machine.
const checkBaseUrl = (value: string): string => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("VOYAGE_BASE_URL is not a valid URL")
  }
  const isLoopbackHttp =
    url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)
  if (url.protocol !== "https:" && !isLoopbackHttp) {
    throw new Error(
      "VOYAGE_BASE_URL must use https:// (http:// is allowed only for localhost)",
    )
  }
  return value
}

// The embedding API allows 2,000 requests a minute. The SDK sends every HTTP
// attempt, its own retries of a 408/429/5xx included, through `fetch`, so
// spacing starts there keeps the whole process (import and searches alike)
// under 1,800 a minute, even when a burst of failures is being retried.
const MAX_REQUESTS_PER_MINUTE = 1_800
const waitForRequestSlot = createRateLimiter(60_000 / MAX_REQUESTS_PER_MINUTE)

const rateLimitedFetch: typeof fetch = async (input, init) => {
  await waitForRequestSlot()
  return fetch(input, init)
}

let _voyage: VoyageAIClient | null = null

const getClient = (): VoyageAIClient => {
  if (!_voyage) {
    if (!process.env.VOYAGE_API_KEY) {
      throw new Error("VOYAGE_API_KEY environment variable is required")
    }
    // Bound the request lifetime so a stalled Voyage call can't hang a search
    // request indefinitely; 30s still leaves headroom for the larger
    // per-chapter batches during import. Default retries (2) are kept.
    _voyage = new VoyageAIClient({
      apiKey: process.env.VOYAGE_API_KEY,
      environment: process.env.VOYAGE_BASE_URL
        ? checkBaseUrl(process.env.VOYAGE_BASE_URL)
        : DEFAULT_BASE_URL,
      timeoutInSeconds: 30,
      fetch: rateLimitedFetch,
    })
  }
  return _voyage
}

// Verses are embedded as documents and searches as queries: Voyage prepends a
// different retrieval prompt to each, and both sides need it for the best
// ranking.
//
// The model is contextual: `verses` must be one chapter's verses in order.
// They are sent as the chunks of a single document, so each verse's vector
// also reflects the verses around it (a verse that only says "He rebuked the
// wind" still lands near a search for Jesus calming the storm).
export const generateChapterEmbeddings = async (
  verses: string[],
): Promise<number[][]> => {
  if (!verses || verses.length === 0) {
    return []
  }

  const validVerses: { index: number; text: string }[] = []
  verses.forEach((text, index) => {
    if (text && text.trim().length > 0) {
      validVerses.push({ index, text: text.trim() })
    }
  })

  if (validVerses.length === 0) {
    return verses.map(() => [])
  }

  try {
    const { rawResponse } = await getClient().contextualizedEmbed({
      model: EMBEDDING_MODEL,
      outputDimension: EMBEDDING_DIMENSIONS,
      inputType: "document",
      inputs: [validVerses.map((v) => v.text)],
    })

    // Map by the chunk index the API reports rather than by array position
    // (which is all the SDK's own result uses), so a reordered or unexpectedly
    // sized response can't pair verses with the wrong vector.
    const result: number[][] = verses.map(() => [])
    for (const item of rawResponse.data?.[0]?.data ?? []) {
      const source =
        item.index === undefined ? undefined : validVerses[item.index]
      if (source && item.embedding) {
        result[source.index] = item.embedding
      }
    }

    return result
  } catch (error) {
    console.error("Error generating embeddings:", error)
    throw new Error(
      `Failed to generate embeddings: ${error instanceof Error ? error.message : "Unknown error"}`,
    )
  }
}

export const generateQueryEmbedding = async (
  text: string,
): Promise<number[]> => {
  if (!text || text.trim().length === 0) {
    throw new Error("Text cannot be empty")
  }

  try {
    // A query is a document of one chunk: it has no surrounding context.
    const { rawResponse } = await getClient().contextualizedEmbed({
      model: EMBEDDING_MODEL,
      outputDimension: EMBEDDING_DIMENSIONS,
      inputType: "query",
      inputs: [[text]],
    })

    const embedding = rawResponse.data?.[0]?.data?.[0]?.embedding
    if (!embedding) {
      throw new Error("Embedding response contained no vector")
    }
    return embedding
  } catch (error) {
    console.error("Error generating embedding:", error)
    throw new Error(
      `Failed to generate embedding: ${error instanceof Error ? error.message : "Unknown error"}`,
    )
  }
}
