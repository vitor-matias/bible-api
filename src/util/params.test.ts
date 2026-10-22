import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { NotFoundError } from "./errors"
import {
  getImportState,
  isDataAvailable,
  isSemanticSearchAvailable,
  setImportState,
} from "./importState"
import { parseNumericParam } from "./parseParams"
import { parseTrustProxy } from "./trustProxy"

describe("parseNumericParam", () => {
  it("accepts canonical non-negative integers", () => {
    assert.equal(parseNumericParam("0"), 0)
    assert.equal(parseNumericParam("150"), 150)
  })

  it("rejects anything else as NaN", () => {
    for (const value of [undefined, "", "01", "1abc", "2.5", "-1", " 1"]) {
      assert.ok(Number.isNaN(parseNumericParam(value)), `${value}`)
    }
    // Past 2^53 distinct inputs would round onto the same number.
    assert.ok(Number.isNaN(parseNumericParam("9007199254740993")))
  })
})

describe("parseTrustProxy", () => {
  it("accepts false, a hop count, or a proxy-addr value", () => {
    assert.equal(parseTrustProxy("false"), false)
    assert.equal(parseTrustProxy(" 2 "), 2)
    assert.equal(parseTrustProxy("loopback"), "loopback")
    assert.equal(parseTrustProxy("10.0.0.0/8"), "10.0.0.0/8")
  })

  it("rejects values that trust every hop or none", () => {
    for (const value of ["true", "0", "1.5", "-1", "Infinity"]) {
      assert.throws(() => parseTrustProxy(value), TypeError, value)
    }
    assert.throws(() => parseTrustProxy("99999999999999999999"), /too large/)
  })
})

describe("importState", () => {
  it("serves data once ready or degraded, and semantic search only when ready", () => {
    const cases = [
      ["loading", false, false],
      ["ready", true, true],
      ["degraded", true, false],
      ["failed", false, false],
    ] as const

    for (const [state, data, semantic] of cases) {
      setImportState(state)
      assert.equal(getImportState(), state)
      assert.equal(isDataAvailable(), data, state)
      assert.equal(isSemanticSearchAvailable(), semantic, state)
    }
  })
})

describe("NotFoundError", () => {
  it("is an Error with a stable name", () => {
    const error = new NotFoundError()
    assert.ok(error instanceof Error)
    assert.equal(error.name, "NotFoundError")
    assert.equal(error.message, "Not Found")
  })
})
