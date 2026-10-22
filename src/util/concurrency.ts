// Runs an async mapper over items with at most `limit` of them in flight.
// Plain Promise.all on a nested fan-out (every chapter of every book) puts the
// whole corpus on the wire and in heap at once.
export const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  // A limit below 1 would start no workers and resolve to a sparse array of
  // undefined without ever calling the mapper.
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError(
      `Concurrency limit must be a positive integer: ${limit}`,
    )
  }

  const results = new Array<R>(items.length)
  let next = 0
  // Promise.all rejects on the first error but leaves the other workers
  // running; without this flag they would keep issuing work for a result that
  // is already discarded.
  let failed = false

  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next
      next++
      try {
        results[index] = await mapper(items[index], index)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  )

  return results
}

export type TaskPool = {
  submit: (task: () => Promise<void>) => void
  drain: () => Promise<void>
}

// Runs submitted tasks in the background with at most `limit` in flight and
// starts spaced at least `minIntervalMs` apart, so a request rate limit holds
// however fast the calls return. Unlike mapWithConcurrency, the caller keeps
// submitting while earlier tasks run. drain() resolves once every task has
// settled, or rejects with the first task error; after an error, queued tasks
// are dropped instead of started.
export const createTaskPool = (limit: number, minIntervalMs = 0): TaskPool => {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError(
      `Concurrency limit must be a positive integer: ${limit}`,
    )
  }

  const queue: (() => Promise<void>)[] = []
  const workers = new Set<Promise<void>>()
  // Counted apart from `workers`: a worker leaves that set a few microtasks
  // after its loop ends, and a task submitted in between would otherwise wait
  // in the queue with no worker left to start it.
  let active = 0
  let nextStart = 0
  let failure: { error: unknown } | null = null

  const waitForStartSlot = async () => {
    const now = Date.now()
    const start = Math.max(now, nextStart)
    nextStart = start + minIntervalMs
    if (start > now) {
      await new Promise((resolve) => setTimeout(resolve, start - now))
    }
  }

  // Never rejects: an error is kept for drain(), so a pool nobody drains yet
  // cannot raise an unhandled rejection.
  const work = async () => {
    try {
      while (!failure && queue.length > 0) {
        const task = queue.shift() as () => Promise<void>
        // Sequential on purpose: each worker runs one task at a time; the pool
        // gets its concurrency from running `limit` workers side by side.
        await waitForStartSlot() // NOSONAR
        try {
          await task() // NOSONAR
        } catch (error) {
          failure ??= { error }
        }
      }
    } finally {
      active--
    }
  }

  return {
    submit: (task) => {
      queue.push(task)
      if (active < limit) {
        active++
        const worker = work().finally(() => workers.delete(worker))
        workers.add(worker)
      }
    },
    drain: async () => {
      // Looped on purpose: a task can submit more work, starting a worker
      // that the earlier Promise.all did not include.
      while (workers.size > 0) {
        await Promise.all(workers) // NOSONAR
      }
      if (failure) throw failure.error
    },
  }
}
