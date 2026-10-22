// The model services/voyage/embeddings.ts calls, and the vector sizes it can
// produce: voyage-4-large defaults to 1024 and also offers 256, 512 and 2048.
// Any other size is rejected by the API, which would fail every chapter of an
// import one by one, so it is rejected here instead, once, at startup. Shorter
// vectors shrink what the database and the API's memory hold in proportion: 512
// is half the default, which is what lets the whole corpus fit a small Valkey
// plan and a small API instance.
//
// Changing the model or the size makes every stored vector unusable (another
// model's vectors share no space with this one's, and the sizes must match the
// query's), so bump IMPORT_COMPLETE_KEY in importMarker.ts along with it.
export const EMBEDDING_MODEL = "voyage-4-large"
const SUPPORTED_EMBEDDING_DIMENSIONS: readonly number[] = [256, 512, 1024, 2048]
const DEFAULT_EMBEDDING_DIMENSIONS = 512

export const parseEmbeddingDimensions = (raw: string | undefined): number => {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_EMBEDDING_DIMENSIONS
  }

  const value = Number(raw)

  if (!SUPPORTED_EMBEDDING_DIMENSIONS.includes(value)) {
    throw new RangeError(
      `EMBEDDING_DIMENSIONS must be one of ${SUPPORTED_EMBEDDING_DIMENSIONS.join(", ")}: "${raw}"`,
    )
  }

  return value
}

// Read lazily: index.ts loads .env after its imports have been evaluated, so a
// value read while this module loads would ignore the .env file.
let dimensions: number | undefined

export const getEmbeddingDimensions = (): number => {
  dimensions ??= parseEmbeddingDimensions(process.env.EMBEDDING_DIMENSIONS)
  return dimensions
}

// Vectors are stored as raw little-endian float32 bytes: 4 bytes per number
// instead of the several times that a JSON array of doubles takes.
export const encodeVector = (vector: readonly number[]): Buffer => {
  const expected = getEmbeddingDimensions()

  // A wrong-sized vector would be stored happily and then silently mis-read, so
  // it is rejected here, where the changed model or setting is still visible.
  if (vector.length !== expected) {
    throw new Error(
      `Expected a ${expected}-dimension embedding, got ${vector.length}`,
    )
  }

  const buffer = Buffer.allocUnsafe(expected * 4)
  for (let i = 0; i < expected; i++) {
    buffer.writeFloatLE(vector[i], i * 4)
  }
  return buffer
}

// Reads one stored vector into `target` starting at `offset`, scaled to unit
// length so a plain dot product is the cosine similarity. Returns false, and
// writes nothing, when the buffer is not exactly one vector long.
export const decodeVectorInto = (
  buffer: Buffer,
  target: Float32Array,
  offset: number,
): boolean => {
  const expected = getEmbeddingDimensions()

  if (buffer.byteLength !== expected * 4) return false

  let squares = 0
  for (let i = 0; i < expected; i++) {
    const value = buffer.readFloatLE(i * 4)
    target[offset + i] = value
    squares += value * value
  }

  scaleToUnitLength(target, offset, expected, squares)
  return true
}

// The query vector, in the same form the stored ones are decoded into.
export const toQueryVector = (vector: readonly number[]): Float32Array => {
  const expected = getEmbeddingDimensions()

  if (vector.length !== expected) {
    throw new Error(
      `Expected a ${expected}-dimension embedding, got ${vector.length}`,
    )
  }

  const result = new Float32Array(expected)
  let squares = 0
  for (let i = 0; i < expected; i++) {
    result[i] = vector[i]
    squares += vector[i] * vector[i]
  }

  scaleToUnitLength(result, 0, expected, squares)
  return result
}

const scaleToUnitLength = (
  target: Float32Array,
  offset: number,
  length: number,
  squares: number,
): void => {
  // An all-zero vector has no direction; leave it at zero so it scores 0.
  if (squares === 0) return

  const norm = Math.sqrt(squares)
  for (let i = 0; i < length; i++) {
    target[offset + i] /= norm
  }
}
