// Shared startup state. Lives in its own module so both the server bootstrap
// (which owns the import) and the request handlers can read it without a
// circular import.
export type ImportState = "loading" | "ready" | "degraded" | "failed"

let state: ImportState = "loading"

export const getImportState = (): ImportState => state

export const setImportState = (next: ImportState): void => {
  state = next
}

// Verses and books are fully imported. "degraded" only means the semantic index
// is incomplete (chapters that failed to embed, or vectors the index skipped),
// which does not affect the primary data.
export const isDataAvailable = (): boolean =>
  state === "ready" || state === "degraded"

// The vector index is known to hold every verse, so KNN results cover the whole
// corpus rather than an arbitrary subset.
export const isSemanticSearchAvailable = (): boolean => state === "ready"
