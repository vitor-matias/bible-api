import OpenAI from "openai"

require("dotenv").config()

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY environment variable is required")
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

/**
 * Generates embedding vectors for multiple texts using OpenAI's `text-embedding-3-small` model.
 *
 * This function batches multiple texts into a single API call, which is more efficient than
 * generating embeddings one at a time. Empty texts are filtered out, and their corresponding
 * positions in the result array will contain empty arrays.
 *
 * @param texts - An array of input texts to embed. Empty texts will be skipped.
 * @returns A promise that resolves to an array of numeric arrays, where each inner array represents
 *          an embedding vector. Positions corresponding to invalid texts will contain empty arrays.
 *
 * @throws {Error} If the embedding request to OpenAI fails for any reason, including network issues,
 *                 invalid or missing `OPENAI_API_KEY`, or other API errors. The original error message,
 *                 when available, is included in the thrown error.
 */
export const generateEmbeddings = async (
  texts: string[],
): Promise<number[][]> => {
  if (!texts || texts.length === 0) {
    return []
  }

  // Filter out empty texts and track their indices
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
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: validTexts.map((v) => v.text),
    })

    // Map embeddings back to original indices
    const result: number[][] = texts.map(() => [])
    response.data.forEach((embedding, i) => {
      result[validTexts[i].index] = embedding.embedding
    })

    return result
  } catch (error) {
    console.error("Error generating embeddings:", error)
    throw new Error(
      `Failed to generate embeddings: ${error instanceof Error ? error.message : "Unknown error"}`,
    )
  }
}

/**
 * Generates an embedding vector for the given text using OpenAI's `text-embedding-3-small` model.
 *
 * The input text must be non-empty and no longer than 2,000 characters. This function wraps
 * the OpenAI embeddings API and returns the first embedding vector from the response.
 *
 * @param text - The input text to embed. Must be a non-empty string with a maximum length of 2,000 characters.
 * @returns A promise that resolves to a numeric array representing the embedding vector.
 *
 * @throws {Error} If the `text` is empty or only whitespace.
 * @throws {Error} If the `text` exceeds the 2,000 character limit.
 * @throws {Error} If the embedding request to OpenAI fails for any reason, including network issues,
 *                 invalid or missing `OPENAI_API_KEY`, or other API errors. The original error message,
 *                 when available, is included in the thrown error.
 */
export const generateEmbedding = async (text: string): Promise<number[]> => {
  if (!text || text.trim().length === 0) {
    throw new Error("Text cannot be empty")
  }

  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    })

    return response.data[0].embedding
  } catch (error) {
    console.error("Error generating embedding:", error)
    throw new Error(
      `Failed to generate embedding: ${error instanceof Error ? error.message : "Unknown error"}`,
    )
  }
}
