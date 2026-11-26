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
