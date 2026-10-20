import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "../../util/vectorBuffer"
import { callGemini } from "./client"

// batchEmbedContents accepts at most this many texts per request.
export const GEMINI_MAX_BATCH = 100

// gemini-embedding-2 takes no task type: queries and documents are told apart
// by these prefixes, in the form Google documents for retrieval. Queries must
// be embedded the same way as the vectors already in the index.
export const QUERY_PREFIX = "task: search result | query: "
export const DOCUMENT_PREFIX = "title: none | text: "

// Bound each request so a stalled call can't hang a search request
// indefinitely; 30s still leaves headroom for a full batch during import.
const REQUEST_TIMEOUT_MS = 30_000
const DEFAULT_ATTEMPTS = 3

type GeminiBatchResponse = { embeddings?: { values: number[] }[] }

export type BatchEmbedOptions = {
  dimensions: number
  // RETRIEVAL_QUERY or RETRIEVAL_DOCUMENT, for models that accept one
  // (gemini-embedding-001; gemini-embedding-2 rejects it).
  taskType?: string
  // Tries per request, the first included.
  maxAttempts?: number
}

// One batchEmbedContents request for at most GEMINI_MAX_BATCH texts, returning
// a vector per text in order.
export const batchEmbedContents = async (
  model: string,
  texts: string[],
  { dimensions, taskType, maxAttempts = DEFAULT_ATTEMPTS }: BatchEmbedOptions,
): Promise<number[][]> => {
  const { embeddings } = await callGemini<GeminiBatchResponse>(
    `${model}:batchEmbedContents`,
    {
      requests: texts.map((text) => ({
        model: `models/${model}`,
        content: { parts: [{ text }] },
        outputDimensionality: dimensions,
        ...(taskType && { taskType }),
      })),
    },
    { timeoutMs: REQUEST_TIMEOUT_MS, maxAttempts },
  )
  // The response carries no indices, only order, so one of another length
  // cannot be paired with its texts.
  if (embeddings?.length !== texts.length) {
    throw new Error(
      `Gemini API returned ${embeddings?.length ?? 0} embeddings for ${texts.length} texts`,
    )
  }
  return embeddings.map((embedding) => embedding.values)
}

export const generateEmbeddings = async (
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
    const result: number[][] = texts.map(() => [])
    // A chapter can exceed one request (Psalm 119 has 176 verses).
    for (let i = 0; i < validTexts.length; i += GEMINI_MAX_BATCH) {
      const batch = validTexts.slice(i, i + GEMINI_MAX_BATCH)
      const vectors = await batchEmbedContents(
        EMBEDDING_MODEL,
        batch.map((v) => DOCUMENT_PREFIX + v.text),
        { dimensions: EMBEDDING_DIMENSIONS },
      )
      batch.forEach((v, j) => {
        result[v.index] = vectors[j]
      })
    }

    return result
  } catch (error) {
    console.error("Error generating embeddings:", error)
    throw new Error(
      `Failed to generate embeddings: ${error instanceof Error ? error.message : "Unknown error"}`,
    )
  }
}

// Embeds search queries (at most GEMINI_MAX_BATCH) in one request.
export const generateQueryEmbeddings = async (
  texts: string[],
): Promise<number[][]> => {
  if (texts.length === 0 || texts.some((text) => text.trim().length === 0)) {
    throw new Error("Text cannot be empty")
  }

  try {
    return await batchEmbedContents(
      EMBEDDING_MODEL,
      texts.map((text) => QUERY_PREFIX + text),
      { dimensions: EMBEDDING_DIMENSIONS },
    )
  } catch (error) {
    console.error("Error generating embedding:", error)
    throw new Error(
      `Failed to generate embedding: ${error instanceof Error ? error.message : "Unknown error"}`,
    )
  }
}

export const generateEmbedding = async (text: string): Promise<number[]> => {
  const [vector] = await generateQueryEmbeddings([text])
  return vector
}
