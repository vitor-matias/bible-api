import OpenAI from "openai"

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY environment variable is required")
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

/**
 * Generates an embedding vector for the given text using OpenAI's `text-embedding-3-small` model.
 *
 * The input text must be non-empty and no longer than 8,000 characters. This function wraps
 * the OpenAI embeddings API and returns the first embedding vector from the response.
 *
 * @param text - The input text to embed. Must be a non-empty string with a maximum length of 8,000 characters.
 * @returns A promise that resolves to a numeric array representing the embedding vector.
 *
 * @throws {Error} If the `text` is empty or only whitespace.
 * @throws {Error} If the `text` exceeds the 8,000 character limit.
 * @throws {Error} If the embedding request to OpenAI fails for any reason, including network issues,
 *                 invalid or missing `OPENAI_API_KEY`, or other API errors. The original error message,
 *                 when available, is included in the thrown error.
 */
export const generateEmbedding = async (text: string): Promise<number[]> => {
  if (!text || text.trim().length === 0) {
    throw new Error("Text cannot be empty")
  }

  if (text.length > 8000) {
    throw new Error("Text is too long (maximum 8000 characters)")
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
