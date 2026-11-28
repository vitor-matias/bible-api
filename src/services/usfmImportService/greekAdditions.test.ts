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
    assert.equal(one["1"].extra?.chapterNumberStarts, undefined)
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

  it("marks where a mid-chapter supplement's letter is printed", () => {
    // B has a heading ahead of its first verse: the verse ending with it. C has none.
    assert.equal(split("3")["2"].extra?.supplementLetter, "B")
    assert.equal(split("4")["1"].extra, undefined)
    assert.equal(split("4")["2"].extra?.supplementLetter, "C")
  })

  it("flags the supplement's verses, and only those", () => {
    const flagged = (c: USFMChapter) =>
      Object.keys(c)
        .filter((k) => k !== "front")
        .map((k) => c[k].extra?.supplement === true)
    assert.deepEqual(flagged(split("1")), [true, true, false, false])
    assert.deepEqual(flagged(split("3")), [
      false,
      false,
      true,
      true,
      false,
      false,
    ])
  })

  it("marks the headings inside a supplement, not the one ending it", () => {
    const marked = (c: USFMChapter, key: string) =>
      c[key].verseObjects
        .filter((o) => o.type === "section")
        .map((o) => [(o.content ?? "").trim(), o.supplement === true])
    const one = split("1")
    assert.deepEqual(marked(one, "front"), [["Um sonho", true]])
    assert.deepEqual(marked(one, "2"), [["Banquete", false]])
    const three = split("3")
    assert.deepEqual(marked(three, "2"), [["Cópia", true]])
    const four = split("4")
    assert.deepEqual(marked(four, "2"), [["Seguinte", false]])
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

  it("keeps a verse bridge in place in a chapter with an addition", () => {
    const chapter = usfm.toJSON(String.raw`\id EST
\c 5
\v 1 Um.
\v 2-3 Dois e três.
\v 4 Quatro.
\cp D
\p
\va 1\va* D um.
`).chapters["5"]

    assert.deepEqual(labels(splitGreekAdditions(chapter)), [
      "1",
      "2-3",
      "4",
      "1",
    ])
  })
})
