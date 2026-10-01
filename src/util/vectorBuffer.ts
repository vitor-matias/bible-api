// The model services/openai/embeddings.ts calls, the vector size it requests,
// and what the vector index (embeddingIndex.ts) is built for. They live beside
// the encoder so a change to one cannot leave the others behind. The API is
// asked for EMBEDDING_DIMENSIONS explicitly (1536 is text-embedding-3-small's
// native size, so its output is unchanged), and a model that cannot produce
// that size is rejected by the API instead of filling the index with vectors
// it skips.
export const EMBEDDING_MODEL = "text-embedding-3-small"
export const EMBEDDING_DIMENSIONS = 1536
export const EMBEDDING_VECTOR_TYPE = "FLOAT32"

// RediSearch reads a FLOAT32 vector as its raw bytes. Stored embeddings and
// query vectors both go through here so they can never disagree on encoding.
//
// HSET accepts a blob of any length, but the index silently skips one that is
// not EMBEDDING_DIMENSIONS floats long, so that is rejected here, where the
// import can still count it as a failure.
export const toFloat32Buffer = (vector: number[]): Buffer => {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Expected a ${EMBEDDING_DIMENSIONS}-dimension embedding, got ${vector.length}`,
    )
  }
  return Buffer.from(new Float32Array(vector).buffer)
}
