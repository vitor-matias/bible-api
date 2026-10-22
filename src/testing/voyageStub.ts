import { createServer, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"

export type StubRequest = { url: string; body: Record<string, unknown> }
export type StubResponder = (
  body: Record<string, unknown>,
  res: ServerResponse,
) => void

// Answers like /contextualizedembeddings: one vector per chunk, each filled
// with its chunk's text length so a test can tell which chunk it came from.
// Chunks come back in reverse order, so mapping by array position would fail.
export const reversedVectors: StubResponder = (body, res) => {
  const inputs = body.inputs as string[][]
  const dimension = body.output_dimension as number
  res.writeHead(200, { "content-type": "application/json" })
  res.end(
    JSON.stringify({
      object: "list",
      model: body.model,
      usage: { total_tokens: 1 },
      data: inputs.map((chunks, index) => ({
        object: "list",
        index,
        data: chunks
          .map((chunk, chunkIndex) => ({
            object: "embedding",
            index: chunkIndex,
            embedding: new Array(dimension).fill(chunk.length),
          }))
          .reverse(),
      })),
    }),
  )
}

export const errorResponse =
  (status: number): StubResponder =>
  (_body, res) => {
    res.writeHead(status, { "content-type": "application/json" })
    res.end(JSON.stringify({ detail: `stub error ${status}` }))
  }

// A local stand-in for the Voyage API on a free loopback port. Point
// VOYAGE_BASE_URL at `url` before the embeddings client is first used.
export const startVoyageStub = async () => {
  const requests: StubRequest[] = []
  let responder: StubResponder = reversedVectors

  const server = createServer((req, res) => {
    let raw = ""
    req.on("data", (chunk) => {
      raw += chunk
    })
    req.on("end", () => {
      const body = JSON.parse(raw)
      requests.push({ url: req.url ?? "", body })
      responder(body, res)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    requests,
    respondWith: (next: StubResponder) => {
      responder = next
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
