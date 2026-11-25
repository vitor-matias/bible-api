import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { alignVerses, type TimedWord } from "./alignVerses"

/** Words said one every half second from `from`, as a transcript gives them. */
const said = (text: string, from: number): TimedWord[] =>
  text
    .split(" ")
    .map((word, i) => ({ text: ` ${word}`, start: from + i * 0.5 }))

const verses = [
  { number: 0, text: "Criação do mundo" },
  { number: 1, text: "No princípio, quando Deus criou os céus e a terra," },
  { number: 2, text: "a terra era informe e vazia," },
  { number: 3, text: "Deus disse: «Faça-se a luz.» E a luz foi feita." },
]

describe("alignVerses", () => {
  it("starts each verse where its first words are said", () => {
    const words = [
      ...said("Génesis 1", 56),
      ...said("No princípio quando Deus criou os céus e a terra", 58),
      ...said("a terra era informe e vazia", 64),
      ...said("Deus disse Faça-se a luz E a luz foi feita", 70),
    ]
    assert.deepEqual(alignVerses(words, verses, 56, 80), {
      times: [
        [1, 58],
        [2, 64],
        [3, 70],
      ],
      anchored: 3,
    })
  })

  it("places a verse whose first word was missed from the next ones", () => {
    const words = [
      ...said("quando Deus criou os céus e a terra", 59),
      ...said("a terra era informe e vazia", 64),
      ...said("Deus disse Faça-se a luz E a luz foi feita", 70),
    ]
    // «No princípio» unheard: two words back from «quando», at 0.33 s each.
    const result = alignVerses(words, verses, 56, 80)
    assert.deepEqual(result?.times[0], [1, 58.34])
  })

  it("puts an unmatched verse between its neighbours, by its words", () => {
    const words = [
      ...said("No princípio quando Deus criou os céus e a terra", 58),
      ...said("ruído que não se entende", 64),
      ...said("Deus disse Faça-se a luz E a luz foi feita", 70),
    ]
    const result = alignVerses(words, verses, 56, 80)
    assert.equal(result?.anchored, 2)
    const [, second] = result?.times[1] ?? []
    assert.ok(second > 58 && second < 70, `verse 2 at ${second}`)
  })

  // João 5:4 is left out of the text: "[]", no words to say.
  it("places a verse with no words between its neighbours", () => {
    const withGap = [
      ...verses.slice(0, 3),
      { number: 3, text: "[] " },
      { ...verses[3], number: 4 },
    ]
    const words = [
      ...said("No princípio quando Deus criou os céus e a terra", 58),
      ...said("a terra era informe e vazia", 64),
      ...said("Deus disse Faça-se a luz E a luz foi feita", 70),
    ]
    const result = alignVerses(words, withGap, 56, 80)
    assert.deepEqual(
      result?.times.map(([number]) => number),
      [1, 2, 3, 4],
    )
    assert.deepEqual(result?.times[3], [4, 70])
  })

  it("never goes back in time on a stray match", () => {
    // Verse 3's words said again, out of order, before verse 2.
    const words = [
      ...said("No princípio quando Deus criou os céus e a terra", 58),
      ...said("Deus disse", 61),
      ...said("a terra era informe e vazia", 64),
      ...said("Deus disse Faça-se a luz E a luz foi feita", 70),
    ]
    const times = alignVerses(words, verses, 56, 80)?.times ?? []
    for (let i = 1; i < times.length; i++) {
      assert.ok(times[i][1] >= times[i - 1][1], JSON.stringify(times))
    }
    assert.equal(times[2][1], 70)
  })

  it("keeps every time inside the chapter's reading", () => {
    const words = said("No princípio quando Deus criou os céus e a terra", 50)
    const times =
      alignVerses(
        [...words, ...said("a terra era informe e vazia Deus disse", 64)],
        verses,
        56,
        66,
      )?.times ?? []
    for (const [, time] of times) assert.ok(time >= 56 && time <= 66)
  })

  it("gives up when too few verses line up with what was said", () => {
    assert.equal(
      alignVerses(
        said("outra coisa completamente diferente", 58),
        verses,
        56,
        80,
      ),
      null,
    )
  })
})
