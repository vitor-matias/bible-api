// The model services/gemini/embeddings.ts calls, the vector size it requests,
// and what the vector index (embeddingIndex.ts) is built for. They live beside
// the encoder so a change to one cannot leave the others behind, and the
// import marker in index.ts includes both, so changing either forces a
// reimport rather than mixing two models' vectors in one index.
//
// gemini-embedding-2 natively returns 3072 dimensions. 1536 is a truncated
// size it is trained to produce: on this corpus it ranked close to 3072
// (src/scripts/embeddingEval) at half the memory, which a 1 GB Redis needs.
// The relevance cut in services/search/semanticSearch.ts is calibrated for
// this model and size.
export const EMBEDDING_MODEL = "gemini-embedding-2"
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
