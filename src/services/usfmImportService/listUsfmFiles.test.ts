import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, describe, it } from "node:test"
import { listUsfmFiles } from "./listUsfmFiles"

describe("listUsfmFiles", () => {
  const folders: string[] = []

  const folderWith = (...names: string[]): string => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "usfm-"))
    folders.push(folder)
    for (const name of names) fs.writeFileSync(path.join(folder, name), "")
    return folder
  }

  afterEach(() => {
    for (const folder of folders.splice(0)) {
      fs.rmSync(folder, { recursive: true, force: true })
    }
  })

  it("lists only the .usfm files, in a fixed order", () => {
    const folder = folderWith(
      "02_Exodo.usfm",
      "notes.txt",
      "00_Intro_Pentateuco.usfm",
      "01_Genesis.usfm",
    )

    assert.deepEqual(listUsfmFiles(folder), [
      "00_Intro_Pentateuco.usfm",
      "01_Genesis.usfm",
      "02_Exodo.usfm",
    ])
  })

  it("refuses an empty folder instead of importing nothing", () => {
    assert.throws(() => listUsfmFiles(folderWith()), /No \.usfm files found/)
  })

  it("refuses a folder holding only other files, like a secrets folder", () => {
    const folder = folderWith("ca.crt", "service-account.json")

    assert.throws(() => listUsfmFiles(folder), /No \.usfm files found/)
  })

  it("refuses a folder that does not exist", () => {
    const missing = path.join(os.tmpdir(), "usfm-does-not-exist")

    assert.throws(() => listUsfmFiles(missing), /ENOENT/)
  })
})
