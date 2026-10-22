import { VoyageAIClient } from "voyageai"
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "../../util/vectorBuffer"

// Model API keys created in MongoDB Atlas are served from ai.mongodb.com. A key
// from the Voyage AI platform, or one scoped to a geography, needs its own
// endpoint, which VOYAGE_BASE_URL sets.
const DEFAULT_BASE_URL = "https://ai.mongodb.com/v1"

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
      environment: process.env.VOYAGE_BASE_URL || DEFAULT_BASE_URL,
      timeoutInSeconds: 30,
    })
  }
  return _voyage
}

// Verses are embedded as documents and searches as queries: Voyage prepends a
// different retrieval prompt to each, and both sides need it for the best
// ranking.
export const generateDocumentEmbeddings = async (
  texts: string[],
): Promise<number[][]> => {
  if (!texts || texts.length === 0) {
    return []
  }

  const validTexts: { index: number; text: string }[] = []
  texts.forEach((text, index) => {
    if (text && text.trim().length > 0) {
      validTexts.push({ index, text: text.trim() })
    }
  })

  if (validTexts.length === 0) {
    return texts.map(() => [])
  }

  try {
    const response = await getClient().embed({
      model: EMBEDDING_MODEL,
      outputDimension: EMBEDDING_DIMENSIONS,
      inputType: "document",
      input: validTexts.map((v) => v.text),
    })

    // Map by the index the API reports rather than by array position, so a
    // reordered or unexpectedly sized response can't pair verses with the
    // wrong vector.
    const result: number[][] = texts.map(() => [])
    for (const item of response.data ?? []) {
      const source =
        item.index === undefined ? undefined : validTexts[item.index]
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
    const response = await getClient().embed({
      model: EMBEDDING_MODEL,
      outputDimension: EMBEDDING_DIMENSIONS,
      inputType: "query",
      input: text,
    })

    const embedding = response.data?.[0]?.embedding
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
