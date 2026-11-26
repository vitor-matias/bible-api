import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { test } from "node:test"
import { changedFiles, hashFiles } from "./fileHashes"

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
