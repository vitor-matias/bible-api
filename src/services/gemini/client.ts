const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models"
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

export type GeminiRequestOptions = {
  // Per attempt.
  timeoutMs: number
  // Tries, the first included.
  maxAttempts: number
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// POSTs to a model method (e.g. "gemini-embedding-2:batchEmbedContents") and
// returns the parsed response. Rate limits, server errors, network errors and
// timeouts are retried with exponential backoff (1s, 2s, 4s... capped at 60s).
export const callGemini = async <T>(
  method: string,
  body: unknown,
  { timeoutMs, maxAttempts }: GeminiRequestOptions,
): Promise<T> => {
  const key = process.env.GOOGLE_API_KEY
  if (!key) {
    throw new Error("GOOGLE_API_KEY environment variable is required")
  }
  const payload = JSON.stringify(body)

  for (let attempt = 1; ; attempt++) {
    // fetch rejects on network errors and timeouts, which are retried like a
    // 429, so they are kept as the failure message instead of thrown.
    const result = await fetch(`${GEMINI_API}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: payload,
      signal: AbortSignal.timeout(timeoutMs),
    }).catch((error: unknown) => String(error))

    let failure: string
    if (typeof result === "string") {
      failure = result
    } else if (result.ok) {
      return (await result.json()) as T
    } else {
      failure = `Gemini API ${result.status}: ${(await result.text()).slice(0, 500)}`
      if (!RETRYABLE_STATUS.has(result.status)) throw new Error(failure)
    }

    if (attempt >= maxAttempts) {
      throw new Error(`${failure} (after ${attempt} attempts)`)
    }
    await sleep(Math.min(60_000, 1000 * 2 ** (attempt - 1)))
  }
}
