import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  decodeVectorInto,
  encodeVector,
  getEmbeddingDimensions,
  parseEmbeddingDimensions,
  toQueryVector,
} from "./vectorBuffer"

// Read lazily on first use, so this applies to every test in the file. 8 is the
// smallest dimension count the setting accepts.
process.env.EMBEDDING_DIMENSIONS = "8"
const DIMENSIONS = 8

// A vector of the configured length that starts with `values`, zero after that.
const vector = (...values: number[]): number[] => [
  ...values,
  ...new Array<number>(DIMENSIONS - values.length).fill(0),
]

const norm = (values: ArrayLike<number>) =>
  Math.sqrt(Array.from(values).reduce((sum, value) => sum + value * value, 0))

describe("parseEmbeddingDimensions", () => {
  it("defaults to 512 when unset or blank", () => {
    assert.equal(parseEmbeddingDimensions(undefined), 512)
    assert.equal(parseEmbeddingDimensions(""), 512)
    assert.equal(parseEmbeddingDimensions("  "), 512)
  })

  it("accepts an integer in range", () => {
    assert.equal(parseEmbeddingDimensions("1536"), 1536)
    assert.equal(parseEmbeddingDimensions("8"), 8)
  })

  it("rejects anything that is not a sensible dimension count", () => {
    for (const value of ["abc", "1.5", "7", "3073", "-512", "0"]) {
      assert.throws(() => parseEmbeddingDimensions(value), RangeError, value)
    }
  })
})

describe("vector encoding", () => {
  it("reads the configured dimension from the environment", () => {
    assert.equal(getEmbeddingDimensions(), DIMENSIONS)
  })

  it("stores four bytes per number", () => {
    assert.equal(encodeVector(vector(1, 2, 3, 4)).byteLength, DIMENSIONS * 4)
  })

  it("round-trips a vector, scaled to unit length", () => {
    const target = new Float32Array(DIMENSIONS)

    assert.equal(
      decodeVectorInto(encodeVector(vector(3, 0, 4)), target, 0),
      true,
    )

    // (3, 0, 4) has length 5, so it comes back as (0.6, 0, 0.8).
    assert.deepEqual(
      Array.from(target),
      vector(Math.fround(0.6), 0, Math.fround(0.8)),
    )
    assert.ok(Math.abs(norm(target) - 1) < 1e-6)
  })

  it("writes each vector at its own offset", () => {
    const target = new Float32Array(DIMENSIONS * 2)

    decodeVectorInto(encodeVector(vector(1)), target, 0)
    decodeVectorInto(encodeVector(vector(0, 2)), target, DIMENSIONS)

    assert.deepEqual(Array.from(target), [...vector(1), ...vector(0, 1)])
  })

  it("rejects a vector of the wrong length instead of storing it", () => {
    assert.throws(() => encodeVector([1, 2, 3]), /Expected a 8-dimension/)
    assert.throws(() => encodeVector(new Array<number>(9).fill(1)), /got 9/)
  })

  it("refuses a stored buffer of the wrong size and leaves the target alone", () => {
    const target = new Float32Array(DIMENSIONS).fill(9)

    assert.equal(decodeVectorInto(Buffer.alloc(12), target, 0), false)
    assert.deepEqual(Array.from(target), new Array<number>(DIMENSIONS).fill(9))
  })

  it("leaves an all-zero vector at zero rather than producing NaN", () => {
    const target = new Float32Array(DIMENSIONS).fill(7)

    decodeVectorInto(encodeVector(vector()), target, 0)

    assert.deepEqual(Array.from(target), vector())
  })
})

describe("toQueryVector", () => {
  it("scales the query to unit length, like the stored vectors", () => {
    const query = toQueryVector(vector(0, 0, 10))

    assert.deepEqual(Array.from(query), vector(0, 0, 1))
  })

  it("rejects a query of the wrong length", () => {
    assert.throws(() => toQueryVector([1, 2]), /Expected a 8-dimension/)
  })
})
