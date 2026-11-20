import assert from "node:assert/strict"
import { describe, it } from "node:test"
import * as usfm from "usfm-js"
import { splitGreekAdditions } from "./greekAdditions"

const ESTER = String.raw`\id EST
\c 1
\cp A
\s2 Um sonho
\p
\va 1\va* Primeiro.
\va 2\va* Segundo.
\s2 Banquete
\p
\v 1 Um.
\v 2 Dois.
\c 3
\v 1 Um.
\v 2 Dois.
\cp B
\s2 Cópia
\p
\va 1\va* B um.
\va 2\va* B dois.
\va 14\va* Resume.
\va 15\va* Resume dois.
\c 4
\v 1 Um.
\cp C
\p
\va 1\va* C um.
\s2 Seguinte
\p
\v 2 Dois.
`

const book = usfm.toJSON(ESTER)
const split = (n: string) => splitGreekAdditions(book.chapters[n])
const labels = (c: USFMChapter) =>
  Object.keys(c)
    .filter((k) => k !== "front")
    .map((k) => c[k].label)
const sections = (objs: USFMVerseObject[]) =>
  objs
    .filter((o) => o.type === "section")
    .map((o) => (o.content ?? o.text ?? "").trim())

describe("splitGreekAdditions", () => {
  it("lays an opening addition out as verses 1, 2, ... ahead of the chapter's own", () => {
    assert.deepEqual(labels(split("1")), ["1", "2", "1", "2"])
    assert.deepEqual(Object.keys(split("1")), ["1", "2", "3", "4", "front"])
  })

  it("prints the opening addition under its letter, and the chapter number after it", () => {
    const one = split("1")
    assert.equal(one.front?.extra?.chapterLabel, "A")
    assert.equal(one["2"].extra?.chapterNumberStarts, true)
    assert.equal(one["1"].extra, undefined)
    assert.equal(one["3"].extra, undefined)
  })

  it("keeps each heading at the end of the verse the source put it in", () => {
    const one = split("1")
    assert.deepEqual(sections(one.front?.verseObjects ?? []), ["Um sonho"])
    assert.deepEqual(sections(one["2"].verseObjects), ["Banquete"])
    assert.deepEqual(sections(one["3"].verseObjects), [])
  })

  it("numbers B's verses and the text that resumes after it", () => {
    assert.deepEqual(labels(split("3")), ["1", "2", "1", "2", "14", "15"])
    assert.equal(split("3").front, undefined)
  })

  it("keeps a heading ending an addition with that addition", () => {
    const four = split("4")
    assert.deepEqual(labels(four), ["1", "1", "2"])
    assert.deepEqual(sections(four["2"].verseObjects), ["Seguinte"])
  })

  it("leaves a chapter without additions as it was", () => {
    const plain = usfm.toJSON("\\id RUT\n\\c 1\n\\v 1 Um.\n").chapters["1"]
    assert.equal(splitGreekAdditions(plain), plain)
  })
})
