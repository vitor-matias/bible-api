import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { fakeRequest, fakeResponse } from "../testing/fakeExpress"
import { validateBooksParams } from "./validateBooksParams"
import { validateQueryParams } from "./validateQueryParams"
import { validateSearchParams } from "./validateSearchParams"

type Middleware = (
  req: ReturnType<typeof fakeRequest>,
  res: ReturnType<typeof fakeResponse>["res"],
  next: () => void,
) => unknown

// Runs a middleware on a query and reports whether it passed the request on,
// and what it answered otherwise.
const run = (middleware: Middleware, query: Record<string, unknown>) => {
  const { res, sent } = fakeResponse()
  let passed = false
  middleware(fakeRequest({ query }), res, () => {
    passed = true
  })
  return { passed, sent, locals: res.locals }
}

describe("validateQueryParams", () => {
  it("passes known parameters with boolean values", () => {
    assert.equal(run(validateBooksParams, {}).passed, true)
    assert.equal(
      run(validateBooksParams, { withChapters: "true" }).passed,
      true,
    )
    assert.equal(
      run(validateBooksParams, { withChapters: "false" }).passed,
      true,
    )
  })

  it("rejects unknown parameters", () => {
    const { passed, sent } = run(validateQueryParams([]), { a: "1", b: "2" })
    assert.equal(passed, false)
    assert.equal(sent.status, 400)
    assert.deepEqual(sent.body, { error: "Unknown query parameters: a, b" })
  })

  it("rejects a boolean parameter that is not true or false", () => {
    for (const value of ["yes", ["true", "true"]]) {
      const { passed, sent } = run(validateBooksParams, { withChapters: value })
      assert.equal(passed, false)
      assert.equal(sent.status, 400)
    }
  })

  it("leaves non-boolean parameters to their own validation", () => {
    const middleware = validateQueryParams(["text", "semantic"], ["semantic"])
    assert.equal(run(middleware, { text: "anything" }).passed, true)
  })
})

describe("validateSearchParams", () => {
  it("passes valid parameters and hands the trimmed text on", () => {
    const { passed, locals } = run(validateSearchParams, {
      text: "  amor  ",
      page: "2",
      limit: "50",
    })
    assert.equal(passed, true)
    assert.equal(locals.searchText, "amor")
  })

  it("rejects missing, blank or overlong text", () => {
    const cases = [
      [{}, "Text parameter is required"],
      [{ text: ["a", "b"] }, "Text parameter is required"],
      [{ text: "   " }, "Text parameter cannot be blank"],
      [
        { text: "x".repeat(201) },
        "Search text is too long (maximum 200 characters)",
      ],
    ] as const

    for (const [query, error] of cases) {
      const { passed, sent } = run(validateSearchParams, query)
      assert.equal(passed, false)
      assert.equal(sent.status, 400)
      assert.deepEqual(sent.body, { error })
    }
  })

  it("rejects malformed or out-of-range page and limit", () => {
    const cases = [
      [{ limit: "0" }, "Limit parameter must be a positive integer"],
      [{ limit: "10abc" }, "Limit parameter must be a positive integer"],
      [{ limit: "101" }, "Limit parameter cannot exceed 100"],
      [{ page: "0" }, "Page parameter must be a positive integer"],
      [{ page: "2.5" }, "Page parameter must be a positive integer"],
      [
        { page: "101", limit: "100" },
        "page x limit cannot exceed 10000 results",
      ],
    ] as const

    for (const [query, error] of cases) {
      const { passed, sent } = run(validateSearchParams, {
        text: "amor",
        ...query,
      })
      assert.equal(passed, false, JSON.stringify(query))
      assert.deepEqual(sent.body, { error })
    }
  })
})
