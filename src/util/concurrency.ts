// Runs an async mapper over items with at most `limit` of them in flight.
// Plain Promise.all on a nested fan-out (every chapter of every book) puts the
// whole corpus on the wire and in heap at once.
export const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length)
  let next = 0

  const worker = async () => {
    while (next < items.length) {
      const index = next
      next++
      results[index] = await mapper(items[index], index)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  )

  return results
}
