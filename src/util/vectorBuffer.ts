// RediSearch reads a FLOAT32 vector as its raw bytes. Stored embeddings and
// query vectors both go through here so they can never disagree on encoding.
export const toFloat32Buffer = (vector: number[]): Buffer =>
  Buffer.from(new Float32Array(vector).buffer)
