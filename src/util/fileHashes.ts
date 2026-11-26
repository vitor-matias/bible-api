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

// A changed, added or removed file all count as a difference.
export const sameHashes = (
  stored: Record<string, string>,
  current: Record<string, string>,
): boolean => {
  const keys = Object.keys(current)
  return (
    keys.length === Object.keys(stored).length &&
    keys.every((file) => stored[file] === current[file])
  )
}
