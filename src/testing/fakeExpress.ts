import type { Request, Response } from "express"

// The slice of an Express request a controller or middleware reads.
export const fakeRequest = ({
  params = {},
  query = {},
  originalUrl = "/",
}: {
  params?: Record<string, string>
  query?: Record<string, unknown>
  originalUrl?: string
} = {}) => ({ params, query, originalUrl }) as unknown as Request

// Records what a handler sends instead of writing to a socket. `body` is what
// reached json() or send(), `type` the content type set through type().
export const fakeResponse = (locals: Record<string, unknown> = {}) => {
  const sent: { status: number; body?: unknown; type?: string } = {
    status: 200,
  }
  const res = {
    locals,
    get statusCode() {
      return sent.status
    },
    status(code: number) {
      sent.status = code
      return res
    },
    type(type: string) {
      sent.type = type
      return res
    },
    json(body: unknown) {
      sent.body = body
      return res
    },
    send(body: unknown) {
      sent.body = body
      return res
    },
  }
  return { res: res as unknown as Response, sent }
}
