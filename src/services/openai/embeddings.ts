import OpenAI from "openai"

let _openai: OpenAI | null = null

const getClient = (): OpenAI => {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable is required")
    }
    // Bound the request lifetime so a stalled OpenAI call can't hang a search
    // request indefinitely; 30s still leaves headroom for the larger
    // per-chapter batches during import. Default retries (2) are kept.
    _openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 30_000,
    })
  }
  return _openai
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
    const response = await getClient().embeddings.create({
      model: "text-embedding-3-small",
      input: validTexts.map((v) => v.text),
    })

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

export const generateEmbedding = async (text: string): Promise<number[]> => {
  if (!text || text.trim().length === 0) {
    throw new Error("Text cannot be empty")
  }

  try {
    const response = await getClient().embeddings.create({
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
