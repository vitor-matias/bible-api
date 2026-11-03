import assert from "node:assert/strict"
import { describe, it } from "node:test"
import * as usfm from "usfm-js"
import { extractBookIntro } from "./bookIntroUtils"

// Parses a book whose header block is `intro`, the way the import does.
const introOf = (intro: string) =>
  extractBookIntro(
    usfm.toJSON(String.raw`\id GEN
\toc1 Génesis
${intro}
\c 1
\p
\v 1 No princípio.
`).headers,
  )

describe("extractBookIntro", () => {
  it("returns undefined for a book with no introduction", () => {
    assert.equal(introOf(""), undefined)
  })

  it("maps each intro marker to its element, reading levels from the tag", () => {
    assert.deepEqual(
      introOf(String.raw`\imt1 Introdução
\imt2 ao Génesis
\is1 Origem
\is3 Autor
\ip Texto corrido.
\iq Verso poético.
\io1 1,1 Criação
\ili Primeiro ponto`),
      [
        { type: "introTitle", level: 1, text: "Introdução" },
        { type: "introTitle", level: 2, text: "ao Génesis" },
        { type: "introSection", level: 1, text: "Origem" },
        // Levels past 2 are clamped.
        { type: "introSection", level: 2, text: "Autor" },
        { type: "introParagraph", text: "Texto corrido." },
        { type: "introParagraph", text: "Verso poético." },
        { type: "introOutline", text: "1,1 Criação" },
        { type: "introListItem", text: "Primeiro ponto" },
      ],
    )
  })

  it("strips character markers and lifts notes into footnotes", () => {
    assert.deepEqual(
      introOf(
        String.raw`\ip Ver \bk Génesis\bk* e nota\f + \fr 1.1 \ft a \it nota\it*\f* fim.`,
      ),
      [
        {
          type: "introParagraph",
          text: "Ver Génesis e nota fim.",
          footnotes: [{ type: "footnote", text: "a nota", reference: "1.1" }],
        },
      ],
    )
  })

  it("drops a header that was nothing but markup", () => {
    assert.deepEqual(
      introOf(String.raw`\ip \bd \bd*
\ip Texto.`),
      [{ type: "introParagraph", text: "Texto." }],
    )
  })

  it("groups consecutive table rows and keeps empty cells in their columns", () => {
    assert.deepEqual(
      introOf(String.raw`\tr \th1 Ano \th2 Evento \thr3 Nota
\tr \tc1 \tc2 \tcr3 x
\tr \thc1 A \tcc2 B \tc3-4 C`),
      [
        {
          type: "introTable",
          rows: [
            ["Ano", "Evento", "Nota"],
            ["", "", "x"],
            ["A", "B", "C"],
          ],
        },
      ],
    )
  })

  it("starts a new table after other content", () => {
    const intro = introOf(String.raw`\tr \tc1 a
\ip Entre tabelas.
\tr \tc1 b`)

    assert.deepEqual(
      intro?.map((element) => element.type),
      ["introTable", "introParagraph", "introTable"],
    )
  })

  it("groups sidebar content and keeps a major section inside it", () => {
    assert.deepEqual(
      introOf(String.raw`\ip Antes.
\esb
\ms Paulo, por ele próprio
\ip Dentro.
\esbe
\ip Depois.`),
      [
        { type: "introParagraph", text: "Antes." },
        {
          type: "introSidebar",
          content: [
            { type: "introMajorSection", text: "Paulo, por ele próprio" },
            { type: "introParagraph", text: "Dentro." },
          ],
        },
        { type: "introParagraph", text: "Depois." },
      ],
    )
  })

  it("discards an empty or unclosed sidebar", () => {
    assert.deepEqual(
      introOf(String.raw`\ip Fora.
\esb
\esbe
\esb
\ip Perdido.`),
      [{ type: "introParagraph", text: "Fora." }],
    )
  })

  it("leaves out a major section that heads the first chapter", () => {
    assert.equal(introOf(String.raw`\ms LIVRO I`), undefined)
    assert.deepEqual(
      introOf(String.raw`\ip Introdução.
\ms LIVRO I`),
      [{ type: "introParagraph", text: "Introdução." }],
    )
  })

  it("ignores intro markers it does not represent", () => {
    assert.deepEqual(
      introOf(String.raw`\iot Índice
\ip Texto.
\ie`),
      [{ type: "introParagraph", text: "Texto." }],
    )
  })
})
