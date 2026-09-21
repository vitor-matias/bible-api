// Shared startup state. Lives in its own module so both the server bootstrap
// (which owns the import) and the request handlers can read it without a
// circular import.
export type ImportState = "loading" | "ready" | "degraded" | "failed"

let state: ImportState = "loading"

export const getImportState = (): ImportState => state

export const setImportState = (next: ImportState): void => {
  state = next
}

// Verses and books are fully imported. "degraded" only means some chapters are
// missing embeddings, which does not affect the primary data.
export const isDataLoaded = (status: ImportState): boolean =>
  status === "ready" || status === "degraded"

export const isDataAvailable = (): boolean => isDataLoaded(state)

// What the API reports once the search index is loaded. A database with no
// verses is a failure even when it is marked as imported: a marker left by an
// import that stored nothing must never look healthy. Otherwise the state is
// "ready" only if every chapter embedded and every stored vector was readable.
export const stateAfterLoad = (
  embeddingFailures: number,
  stats: { verses: number; vectors: number; skippedVectors: number },
): ImportState => {
  if (stats.verses === 0) return "failed"

  const complete =
    embeddingFailures === 0 && stats.vectors > 0 && stats.skippedVectors === 0
  return complete ? "ready" : "degraded"
}

// Every chapter's embeddings were written, so KNN results cover the whole
// corpus rather than an arbitrary subset.
export const isSemanticSearchAvailable = (): boolean => state === "ready"
