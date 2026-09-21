import * as fs from "node:fs"

// The USFM files in a folder, in a fixed order. readdirSync order is
// filesystem-dependent; sorting keeps book numbering (which feeds searchId) and
// introduction slug suffixes identical across machines and reimports.
//
// A folder with no USFM files is an error, not an empty list: importing it used
// to flush the database, store nothing and still mark the import complete,
// which left an API that reported itself healthy with no data at all.
export const listUsfmFiles = (textsPath: string): string[] => {
  const files = fs
    .readdirSync(textsPath)
    .filter((file) => file.endsWith(".usfm"))
    .sort()

  if (files.length === 0) {
    throw new Error(`No .usfm files found in ${textsPath}`)
  }

  return files
}
