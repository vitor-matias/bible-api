import { promises as fs } from "node:fs"
import * as usfm from "usfm-js"

/**
 * USFM text as usfm-js reads it, with table cells' column spans dropped
 * (`\tc3-4` is read as `\tc3`): usfm-js writes one back as `\tc3 -4`, which
 * can't be told from a cell whose text starts "-4", and spans aren't shown.
 */
export const parseUsfm = (content: string): USFMBook =>
  usfm.toJSON(content.replace(/(\\t[hc][rc]?\d+)-\d+/g, "$1"))

/**
 * Takes the file on the path and reads it in to memory
 * @param path
 * @returns
 */
export const readBook = async (path: string): Promise<USFMBook> => {
  try {
    return parseUsfm(await fs.readFile(path, "utf8"))
  } catch (err) {
    console.error(err)
    throw err
  }
}
