import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { test } from "node:test"
import { hashFiles, sameHashes } from "./fileHashes"

test("hashFiles changes with file content", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hashes-"))
  fs.writeFileSync(path.join(dir, "a.usfm"), "one")
  const before = hashFiles(dir, ["a.usfm"])
  assert.ok(sameHashes(before, hashFiles(dir, ["a.usfm"])))
  fs.writeFileSync(path.join(dir, "a.usfm"), "two")
  assert.ok(!sameHashes(before, hashFiles(dir, ["a.usfm"])))
  fs.rmSync(dir, { recursive: true })
})

test("sameHashes catches added and removed files", () => {
  assert.ok(sameHashes({ a: "1" }, { a: "1" }))
  assert.ok(!sameHashes({ a: "1" }, { a: "1", b: "2" }))
  assert.ok(!sameHashes({ a: "1", b: "2" }, { a: "1" }))
  assert.ok(!sameHashes({}, { a: "1" }))
})
