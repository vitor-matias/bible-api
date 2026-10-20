import OpenAI from "openai"
import {
  batchEmbedContents,
  GEMINI_MAX_BATCH,
} from "../../services/gemini/embeddings"

export type InputType = "query" | "document"

type CandidateBase = {
  // Column label in the report.
  label: string
  model: string
  // Vector size requested from the API, and the size that is cached.
  dimensions: number
  // Smaller sizes to evaluate from the same vectors, by keeping the leading
  // components and renormalising. OpenAI's v3 and Google's Gemini models are
  // trained so that prefix is itself an embedding; it is what their size
  // parameters return, so no extra API calls are needed.
  alsoEvaluateAt?: number[]
  // Prepended to each text, for models that take the task in the input.
  queryPrefix?: string
  documentPrefix?: string
}

export type Candidate =
  | (CandidateBase & { provider: "openai" })
  | (CandidateBase & {
      provider: "gemini"
      // gemini-embedding-001 embeds queries and documents differently when
      // told which is which; gemini-embedding-2 rejects the field.
      taskType?: boolean
    })

// Texts per request. OpenAI accepts 2048 inputs but also caps tokens per
// request, which 512 verses stay well under.
export const MAX_BATCH: Record<Candidate["provider"], number> = {
  openai: 512,
  gemini: GEMINI_MAX_BATCH,
}

let _openai: OpenAI | null = null

const getOpenAI = (): OpenAI => {
  if (!_openai) {
    // The SDK backs off on 429s itself; a full-corpus run can hit the
    // per-minute token limit several times.
    _openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 60_000,
      maxRetries: 8,
    })
  }
  return _openai
}

const embedOpenAI = async (
  candidate: Candidate,
  input: string[],
): Promise<number[][]> => {
  const response = await getOpenAI().embeddings.create({
    model: candidate.model,
    dimensions: candidate.dimensions,
    input,
  })
  const vectors = new Array<number[]>(input.length)
  for (const item of response.data) {
    vectors[item.index] = item.embedding
  }
  return vectors
}

// Free-tier keys hit the per-minute quota quickly, so a run retries far more
// patiently than a search request would before giving a candidate up.
const GEMINI_ATTEMPTS = 9

const embedGemini = (
  candidate: Extract<Candidate, { provider: "gemini" }>,
  input: string[],
  type: InputType,
): Promise<number[][]> =>
  batchEmbedContents(candidate.model, input, {
    dimensions: candidate.dimensions,
    taskType: candidate.taskType
      ? type === "query"
        ? "RETRIEVAL_QUERY"
        : "RETRIEVAL_DOCUMENT"
      : undefined,
    maxAttempts: GEMINI_ATTEMPTS,
  })

// Embeds one request's worth of texts (at most MAX_BATCH for the provider).
export const embed = async (
  candidate: Candidate,
  texts: string[],
  type: InputType,
): Promise<number[][]> => {
  const prefix =
    type === "query" ? candidate.queryPrefix : candidate.documentPrefix
  const input = prefix ? texts.map((text) => prefix + text) : texts

  const vectors =
    candidate.provider === "openai"
      ? await embedOpenAI(candidate, input)
      : await embedGemini(candidate, input, type)

  // A short or missing vector would shift every verse after it onto the
  // wrong embedding in the cache.
  if (vectors.length !== texts.length) {
    throw new Error(
      `${candidate.model} returned ${vectors.length} vectors for ${texts.length} texts`,
    )
  }
  for (const vector of vectors) {
    if (vector?.length !== candidate.dimensions) {
      throw new Error(
        `${candidate.model} returned a ${vector?.length ?? 0}-dimension vector, expected ${candidate.dimensions}`,
      )
    }
  }
  return vectors
}
