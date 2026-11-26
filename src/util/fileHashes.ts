import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"

// Redis hash of source file name -> sha256 of its contents, written with the
// completion marker. A start whose files hash differently reimports.
export const FILE_HASHES_KEY = "fileHashes"

export const hashFiles = (
  dir: string,
  files: string[],
): Record<string, string> =>
  Object.fromEntries(
    files.map((file) => [
      file,
      createHash("sha256")
        .update(fs.readFileSync(path.join(dir, file)))
        .digest("hex"),
    ]),
  )

// Names of the files that were changed, added or removed.
export const changedFiles = (
  stored: Record<string, string>,
  current: Record<string, string>,
): string[] =>
  [...new Set([...Object.keys(stored), ...Object.keys(current)])].filter(
    (file) => stored[file] !== current[file],
  )

// readdirSync order is filesystem-dependent. Sorting keeps book numbering
// (which feeds searchId) and introduction slug suffixes identical across
// machines and reimports. A missing or unset directory reads as empty.
export const listSourceFiles = (dir: string | undefined): string[] =>
  (dir && fs.existsSync(dir) ? fs.readdirSync(dir) : [])
    .filter((file) => file.endsWith(".usfm"))
    // By UTF-16 code unit, as a bare sort() would: a locale-aware compare
    // could order names differently on machines with different locale data.
    .sort((a, b) => Number(a > b) - Number(a < b))

export type SourceCheck =
  | { action: "abort"; reason: string; error?: unknown }
  | { action: "skip" }
  | {
      action: "import"
      files: string[]
      fileHashes: Record<string, string>
      message?: string
    }

// Decides what a start does with the source files. `stored` is the hashes of
// the data already loaded, or undefined when the import must run regardless
// (nothing loaded, or --reimport).
export const checkSourceFiles = (
  dir: string | undefined,
  stored: Record<string, string> | undefined,
): SourceCheck => {
  let files: string[]
  let fileHashes: Record<string, string>
  try {
    files = listSourceFiles(dir)
    fileHashes = hashFiles(dir as string, files)
  } catch (error) {
    return {
      action: "abort",
      reason: `cannot read PATH_TO_TEXTS (${dir})`,
      error,
    }
  }

  // An empty or wrongly mounted directory must not be "imported": the flush
  // would wipe the data for nothing.
  if (files.length === 0) {
    return {
      action: "abort",
      reason: `No .usfm files found in PATH_TO_TEXTS (${dir})`,
    }
  }

  if (!stored) return { action: "import", files, fileHashes }

  const changed = changedFiles(stored, fileHashes)
  if (changed.length === 0) return { action: "skip" }

  const message =
    Object.keys(stored).length === 0
      ? "No source file hashes stored yet; reimporting once to record them."
      : `Source files changed since the last import (${changed.join(", ")}); reimporting.`
  return { action: "import", files, fileHashes, message }
}
