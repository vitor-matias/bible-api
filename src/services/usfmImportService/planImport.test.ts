import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { test } from "node:test"
import { FILE_HASHES_KEY, hashFiles } from "../../util/fileHashes"
import { planImport } from "./planImport"

const COMPLETE = "importComplete:test"

const setup = (t: { after: (fn: () => void) => void }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-"))
  t.after(() => fs.rmSync(dir, { recursive: true }))
  fs.writeFileSync(path.join(dir, "a.usfm"), "a")
  return dir
}

const client = (loaded: boolean, hashes: Record<string, string> = {}) => ({
  exists: async (key: string) => Number(loaded && key === COMPLETE),
  hGetAll: async (key: string) => (key === FILE_HASHES_KEY ? hashes : {}),
})

const ok = async () => "pong"
const down = async () => {
  throw new Error("voyage down")
}
const opts = (
  filePath: string | undefined,
  pingEmbeddings = ok,
  reimport = false,
) => ({
  filePath,
  completeKey: COMPLETE,
  reimport,
  pingEmbeddings,
})

test("planImport imports when nothing is loaded", async (t) => {
  const dir = setup(t)
  const plan = await planImport(client(false), opts(dir))
  assert.deepEqual(plan?.files, ["a.usfm"])
})

test("planImport keeps loaded data when the files are unchanged", async (t) => {
  const dir = setup(t)
  const stored = hashFiles(dir, ["a.usfm"])
  assert.equal(await planImport(client(true, stored), opts(dir)), undefined)
  // --reimport ignores the hashes.
  const forced = await planImport(client(true, stored), opts(dir, ok, true))
  assert.deepEqual(forced?.files, ["a.usfm"])
})

test("planImport reimports when a file changed", async (t) => {
  const dir = setup(t)
  const plan = await planImport(client(true, { "a.usfm": "old" }), opts(dir))
  assert.deepEqual(plan?.files, ["a.usfm"])
})

test("planImport keeps loaded data when the import cannot run", async (t) => {
  const dir = setup(t)
  const changed = client(true, { "a.usfm": "old" })
  assert.equal(await planImport(changed, opts(dir, down)), undefined)
  assert.equal(await planImport(changed, opts(undefined)), undefined)
})

test("planImport throws when the import cannot run and nothing is loaded", async (t) => {
  const dir = setup(t)
  await assert.rejects(
    planImport(client(false), opts(dir, down)),
    /voyage down/,
  )
  await assert.rejects(
    planImport(client(false), opts(undefined)),
    /No \.usfm files/,
  )
})
