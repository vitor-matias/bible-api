import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  decodeVectorInto,
  encodeVector,
  getEmbeddingDimensions,
  parseEmbeddingDimensions,
  toQueryVector,
} from "./vectorBuffer"

// Read lazily on first use, so this applies to every test in the file. 256 is
// the smallest size the setting accepts.
process.env.EMBEDDING_DIMENSIONS = "256"
const DIMENSIONS = 256

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

  it("accepts each size the model offers", () => {
    for (const size of [256, 512, 1024, 2048]) {
      assert.equal(parseEmbeddingDimensions(String(size)), size)
    }
  })

  it("rejects any other size, which the API would refuse chapter by chapter", () => {
    // 1536 was OpenAI's size and 768 is a common one; neither is offered here.
    for (const value of [
      "1536",
      "768",
      "8",
      "255",
      "4096",
      "abc",
      "1.5",
      "-512",
      "0",
    ]) {
      assert.throws(() => parseEmbeddingDimensions(value), RangeError, value)
    }
  })

  it("names the sizes it would have accepted", () => {
    assert.throws(
      () => parseEmbeddingDimensions("1536"),
      /256, 512, 1024, 2048/,
    )
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
    assert.throws(
      () => encodeVector([1, 2, 3]),
      new RegExp(`Expected a ${DIMENSIONS}-dimension`),
    )
    assert.throws(
      () => encodeVector(new Array<number>(DIMENSIONS + 1).fill(1)),
      new RegExp(`got ${DIMENSIONS + 1}`),
    )
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
    assert.throws(
      () => toQueryVector([1, 2]),
      new RegExp(`Expected a ${DIMENSIONS}-dimension`),
    )
  })
})
