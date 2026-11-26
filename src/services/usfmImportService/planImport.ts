import { checkSourceFiles, FILE_HASHES_KEY } from "../../util/fileHashes"

type PlanClient = {
  exists(key: string): Promise<number>
  hGetAll(key: string): Promise<Record<string, string>>
}

export type ImportPlan = { files: string[]; fileHashes: Record<string, string> }

// Decides, before anything is touched, whether a start imports. Resolves to
// the files to import, or to undefined when the stored data is kept and
// served: it is current, or the import cannot run and, with complete data
// already stored, refusing it costs nothing. Throws when the import cannot run
// and there is nothing stored to serve.
export const planImport = async (
  client: PlanClient,
  options: {
    filePath: string | undefined
    completeKey: string
    reimport: boolean
    // Only embeddings can rebuild what the flush removes, so this checks they
    // can be generated. A missing, rotated or out-of-quota key throws here.
    pingEmbeddings: () => Promise<unknown>
  },
): Promise<ImportPlan | undefined> => {
  const alreadyLoaded = (await client.exists(options.completeKey)) === 1

  const keep = (reason: string, error?: unknown) => {
    if (!alreadyLoaded) throw error ?? new Error(reason)
    console.error(
      `ERROR: import skipped: ${reason}; the existing data is left in place and served.`,
      ...(error ? [error] : []),
    )
    return undefined
  }

  const source = checkSourceFiles(
    options.filePath,
    alreadyLoaded && !options.reimport
      ? await client.hGetAll(FILE_HASHES_KEY)
      : undefined,
  )
  if (source.action === "abort") return keep(source.reason, source.error)
  if (source.action === "skip") {
    console.info(
      "Bible data already loaded; skipping import. Start with --reimport to force a reload.",
    )
    return undefined
  }
  if (source.message) console.info(source.message)

  try {
    await options.pingEmbeddings()
  } catch (error) {
    return keep(
      "embeddings cannot be generated (check VOYAGE_API_KEY, then restart to retry)",
      error,
    )
  }

  return { files: source.files, fileHashes: source.fileHashes }
}
