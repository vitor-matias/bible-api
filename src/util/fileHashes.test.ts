import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { test } from "node:test"
import { changedFiles, checkSourceFiles, hashFiles } from "./fileHashes"

test("hashFiles changes with file content", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hashes-"))
  t.after(() => fs.rmSync(dir, { recursive: true }))
  fs.writeFileSync(path.join(dir, "a.usfm"), "one")
  const before = hashFiles(dir, ["a.usfm"])
  assert.deepEqual(changedFiles(before, hashFiles(dir, ["a.usfm"])), [])
  fs.writeFileSync(path.join(dir, "a.usfm"), "two")
  assert.deepEqual(changedFiles(before, hashFiles(dir, ["a.usfm"])), ["a.usfm"])
})

test("changedFiles names changed, added and removed files", () => {
  assert.deepEqual(changedFiles({ a: "1" }, { a: "1" }), [])
  assert.deepEqual(changedFiles({ a: "1" }, { a: "2" }), ["a"])
  assert.deepEqual(changedFiles({ a: "1" }, { a: "1", b: "2" }), ["b"])
  assert.deepEqual(changedFiles({ a: "1", b: "2" }, { a: "1" }), ["b"])
  assert.deepEqual(changedFiles({}, { a: "1" }), ["a"])
})

test("checkSourceFiles decides between import, skip and abort", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sources-"))
  t.after(() => fs.rmSync(dir, { recursive: true }))

  assert.equal(checkSourceFiles(dir, undefined).action, "abort")
  assert.equal(checkSourceFiles(undefined, {}).action, "abort")
  assert.equal(checkSourceFiles(path.join(dir, "missing"), {}).action, "abort")

  fs.writeFileSync(path.join(dir, "b.usfm"), "b")
  fs.writeFileSync(path.join(dir, "a.usfm"), "a")
  fs.writeFileSync(path.join(dir, "notes.txt"), "x")

  const first = checkSourceFiles(dir, undefined)
  assert.equal(first.action, "import")
  if (first.action !== "import") return
  assert.deepEqual(first.files, ["a.usfm", "b.usfm"])
  assert.equal(first.message, undefined)

  assert.deepEqual(checkSourceFiles(dir, first.fileHashes), { action: "skip" })

  const fresh = checkSourceFiles(dir, {})
  assert.match(
    fresh.action === "import" ? (fresh.message ?? "") : "",
    /No source file hashes/,
  )

  fs.writeFileSync(path.join(dir, "b.usfm"), "changed")
  const edited = checkSourceFiles(dir, first.fileHashes)
  assert.match(
    edited.action === "import" ? (edited.message ?? "") : "",
    /\(b\.usfm\)/,
  )

  // A directory where a book file should be cannot be read.
  fs.mkdirSync(path.join(dir, "c.usfm"))
  const unreadable = checkSourceFiles(dir, first.fileHashes)
  assert.equal(unreadable.action, "abort")
  assert.ok(unreadable.action === "abort" && unreadable.error)
})
