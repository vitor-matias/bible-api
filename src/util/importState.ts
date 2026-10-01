// Shared startup state. Lives in its own module so both the server bootstrap
// (which owns the import) and the request handlers can read it without a
// circular import.
export type ImportState = "loading" | "ready" | "degraded" | "failed"

// Why a "degraded" process refuses semantic search: v2 embeddings are still
// being converted in place, or the vector index is missing or could not be
// verified to hold every verse.
export type DegradedReason = "migrating" | "incomplete"

let state: ImportState = "loading"
let degradedReason: DegradedReason | null = null

export const getImportState = (): ImportState => state

export const getDegradedReason = (): DegradedReason | null => degradedReason

export const setImportState = (
  next: Exclude<ImportState, "degraded">,
): void => {
  state = next
  degradedReason = null
}

export const setDegraded = (reason: DegradedReason): void => {
  state = "degraded"
  degradedReason = reason
}

// Verses and books are fully imported. "degraded" only takes semantic search
// away; the primary data is complete either way.
export const isDataAvailable = (): boolean =>
  state === "ready" || state === "degraded"

// The vector index is known to hold every verse, so KNN results cover the
// whole corpus rather than an arbitrary subset.
export const isSemanticSearchAvailable = (): boolean => state === "ready"
