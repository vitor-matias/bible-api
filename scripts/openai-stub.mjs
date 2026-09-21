// A local stand-in for OpenAI's POST /v1/embeddings, so the whole API (import,
// startup, semantic search) can run with no API key and no cost.
//
//   node scripts/openai-stub.mjs
//   OPENAI_API_KEY=stub OPENAI_BASE_URL=http://localhost:4011/v1 npm run import
//
// It returns RANDOM unit vectors of the requested size. The import, memory use
// and timing are real, but the semantic search results are meaningless: to judge
// their quality, use the real API.
//
// STUB_PORT (default 4011) and STUB_DIM (default 512) configure it; a request's
// own `dimensions` parameter wins over STUB_DIM, like the real API's.
import { randomFillSync } from "node:crypto"
import { createServer } from "node:http"

const DEFAULT_DIMENSIONS = Number(process.env.STUB_DIM || 512)
const PORT = Number(process.env.STUB_PORT || 4011)

const randomUnitVector = (dimensions) => {
  const vector = new Float32Array(dimensions)
  let squares = 0

  // Two uniform numbers per component, drawn from the operating system's
  // generator in one call. Nothing here needs unpredictability; it is used only
  // so that no pseudo-random generator is involved at all.
  const entropy = randomFillSync(new Uint32Array(2 * dimensions))

  for (let i = 0; i < dimensions; i++) {
    // Box-Muller: gaussian components give uniformly distributed directions.
    // Both numbers fall in (0, 1], so the logarithm is always finite.
    const u = (entropy[2 * i] + 1) / 2 ** 32
    const v = (entropy[2 * i + 1] + 1) / 2 ** 32
    const x = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
    vector[i] = x
    squares += x * x
  }

  const norm = Math.sqrt(squares)
  for (let i = 0; i < dimensions; i++) vector[i] /= norm
  return vector
}

createServer((req, res) => {
  if (req.method !== "POST" || !req.url.endsWith("/embeddings")) {
    res.writeHead(404).end()
    return
  }

  const chunks = []
  req.on("data", (chunk) => chunks.push(chunk))
  req.on("end", () => {
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}")
    const inputs = Array.isArray(body.input) ? body.input : [body.input]
    // The official SDK asks for base64 unless told otherwise.
    const asBase64 = body.encoding_format === "base64"
    const dimensions = Number(body.dimensions) || DEFAULT_DIMENSIONS

    const data = inputs.map((_, index) => {
      const vector = randomUnitVector(dimensions)
      return {
        object: "embedding",
        index,
        embedding: asBase64
          ? Buffer.from(
              vector.buffer,
              vector.byteOffset,
              vector.byteLength,
            ).toString("base64")
          : Array.from(vector),
      }
    })

    res.writeHead(200, { "content-type": "application/json" })
    res.end(
      JSON.stringify({
        object: "list",
        data,
        model: "text-embedding-3-small",
        usage: { prompt_tokens: inputs.length, total_tokens: inputs.length },
      }),
    )
  })
}).listen(PORT, "127.0.0.1", () =>
  console.log(
    `OpenAI embeddings stub on http://127.0.0.1:${PORT}/v1 (${DEFAULT_DIMENSIONS} dimensions)`,
  ),
)
