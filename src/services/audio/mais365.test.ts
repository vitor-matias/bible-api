import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  type BookName,
  findChapterEnd,
  findChapterStarts,
  parseReadings,
} from "./mais365"

const books: BookName[] = [
  { id: "gen", shortName: "Génesis", chapterCount: 50 },
  { id: "job", shortName: "Job", chapterCount: 42 },
  { id: "psa", shortName: "Salmos", chapterCount: 150 },
  { id: "pro", shortName: "Provérbios", chapterCount: 31 },
  { id: "est", shortName: "Ester", chapterCount: 10 },
  { id: "luk", shortName: "Lucas", chapterCount: 24 },
  { id: "oba", shortName: "Abdias", chapterCount: 1 },
  { id: "2ki", shortName: "2 Reis", chapterCount: 25 },
  { id: "sng", shortName: "Cântico dos Cânticos", chapterCount: 8 },
]

const read = (text: string) =>
  parseReadings(
    `<p>Bem-vindo!</p><p>Hoje vamos ler ${text}</p><p>O Padre…</p>`,
    books,
  )

const chapters = (text: string) =>
  read(text).readings.map((r) => `${r.bookId} ${r.chapter}`)

describe("parseReadings", () => {
  it("reads books, chapter ranges and verse ranges", () => {
    assert.deepEqual(chapters("Génesis 37; Job 27–28; Provérbios 3:25-27."), [
      "gen 37",
      "job 27",
      "job 28",
      "pro 3",
    ])
  })

  it("keeps the verses of a chapter read only in part", () => {
    assert.deepEqual(
      read("Génesis 12–13; Provérbios 1:1-7; Salmo 119:57–120.").readings,
      [
        { bookId: "gen", chapter: 12 },
        { bookId: "gen", chapter: 13 },
        { bookId: "pro", chapter: 1, verses: [1, 7] },
        { bookId: "psa", chapter: 119, verses: [57, 120] },
      ],
    )
    // Across chapters, each is read whole as far as this goes.
    assert.deepEqual(read("Lucas 22:39–24:50.").readings[0], {
      bookId: "luk",
      chapter: 22,
    })
  })

  it("reads the readings after «lemos» too", () => {
    const lemos = (text: string) =>
      parseReadings(`<p>Hoje ${text}</p><p>O P. Bernardo…</p>`, books).readings
    assert.equal(lemos("lemos: Génesis 3; Salmo 45.").length, 2)
    assert.equal(
      lemos("dentro do tempo bíblico lemos: Génesis 10-11; Salmo 50.").length,
      3,
    )
  })

  it("carries the book over a bare chapter and joins with 'e'", () => {
    assert.deepEqual(chapters("Génesis 1 e 2 e o Salmo 19."), [
      "gen 1",
      "gen 2",
      "psa 19",
    ])
  })

  it("spans chapters when a range crosses them", () => {
    assert.deepEqual(chapters("Lucas 22:39–24:50; Provérbios 26:20-23."), [
      "luk 22",
      "luk 23",
      "luk 24",
      "pro 26",
    ])
    assert.deepEqual(chapters("Lucas 20–22:38."), [
      "luk 20",
      "luk 21",
      "luk 22",
    ])
  })

  it("skips Ester's lettered additions and reads its chapters", () => {
    assert.deepEqual(read("Ester 5, D, 6–7; Provérbios 21:13–16.").unparsed, [])
    assert.deepEqual(chapters("Ester 5, D, 6–7."), ["est 5", "est 6", "est 7"])
  })

  it("takes a one-chapter book named without a number", () => {
    assert.deepEqual(chapters("Obadias; Provérbios 18:13–16."), [
      "oba 1",
      "pro 18",
    ])
  })

  it("matches names regardless of accents and case", () => {
    assert.deepEqual(chapters("Cântico dos cânticos 1."), ["sng 1"])
    assert.deepEqual(chapters("2 Reis 25."), ["2ki 25"])
  })

  it("reports what it cannot place instead of guessing", () => {
    assert.deepEqual(read("Crónicas 9; Salmo 48.").unparsed, ["Crónicas 9"])
    assert.deepEqual(chapters("Crónicas 9; Salmo 48."), ["psa 48"])
  })

  it("stops at the end of the announcement", () => {
    assert.deepEqual(
      chapters(
        "Salmo 147.O Padre Lourenço Lino acompanha-nos — Sansão e Dalila",
      ),
      ["psa 147"],
    )
  })

  it("finds nothing in an episode that announces no readings", () => {
    assert.deepEqual(parseReadings("<p>Introdução à Igreja</p>", books), {
      readings: [],
      unparsed: [],
    })
  })
})

describe("findChapterStarts", () => {
  const segments = [
    { start: 0, text: " Olá, bem-vindo ao Mais 365" },
    { start: 50, text: " e vamos ouvir Génesis 5 e 6 e o Salmo 136" },
    { start: 56.5, text: " Génesis 5" },
    { start: 63.8, text: " Este é o livro da descendência de Adão" },
    { start: 280.8, text: " Génesis 6" },
    { start: 492.1, text: " Salmo 136." },
    { start: 626.7, text: " Eu sou o Padre Miguel. Em Génesis 6 vimos…" },
  ]
  const readings = [
    { bookId: "gen", chapter: 5 },
    { bookId: "gen", chapter: 6 },
    { bookId: "psa", chapter: 136 },
  ]

  it("starts each chapter at its spoken heading, not at the announcement", () => {
    assert.deepEqual(
      findChapterStarts(segments, readings, books),
      [56.5, 280.8, 492.1],
    )
  })

  it("starts an unannounced first reading after the day's announcement", () => {
    // Dia 6: "…vamos ouvir Génesis 12 e 13," | "Jó 1 e 2 e Provérbios 1, 1 a 7."
    // then Génesis 12 read straight away; Jó and Provérbios headed, the
    // latter cut by Whisper to its verses.
    const day6 = [
      { start: 42.3, text: " Hoje é o dia 6 e vamos ouvir Génesis 12 e 13," },
      { start: 50.1, text: " Jó 1 e 2 e Provérbios 1, 1 a 7." },
      { start: 58.3, text: " O Senhor disse a Abrão, deixa a tua terra" },
      { start: 254.4, text: " Génesis 13" },
      { start: 380, text: " Jó I" },
      { start: 632.3, text: " Jó 2" },
      { start: 770.8, text: " 1 a 7" },
    ]
    assert.deepEqual(
      findChapterStarts(
        day6,
        [
          { bookId: "gen", chapter: 12 },
          { bookId: "gen", chapter: 13 },
          { bookId: "job", chapter: 1 },
          { bookId: "job", chapter: 2 },
          { bookId: "pro", chapter: 1, verses: [1, 7] },
        ],
        books,
      ),
      [58.3, 254.4, 380, 632.3, 770.8],
    )
  })

  it("leaves a chapter without a heading unknown and keeps looking after it", () => {
    const withoutFirst = segments.filter((s) => s.start !== 56.5)
    assert.deepEqual(findChapterStarts(withoutFirst, readings, books), [
      undefined,
      280.8,
      492.1,
    ])
  })

  it("hears ordinals, 'Livro de' and Esther's old spelling", () => {
    const spoken = [
      { start: 1, text: " 2º Livro dos Reis 25" },
      { start: 2, text: " Segundo o livro das Crónicas, 36" },
      { start: 3, text: " Esther 6" },
      { start: 4, text: " Nos capítulos finais do 2º Livro dos Reis 25" },
    ]
    const wanted = [
      { bookId: "2ki", chapter: 25 },
      { bookId: "2ch", chapter: 36 },
      { bookId: "est", chapter: 6 },
    ]
    const withChronicles = [
      ...books,
      { id: "2ch", shortName: "2 Crónicas", chapterCount: 36 },
    ]
    assert.deepEqual(
      findChapterStarts(spoken, wanted, withChronicles),
      [1, 2, 3],
    )
  })
})

describe("findChapterStarts, misheard", () => {
  it("hears the headings Whisper keeps getting wrong", () => {
    const spoken = [
      { start: 1, text: " Edeias 8" },
      { start: 2, text: " Ozeias 10" },
      { start: 3, text: " Jusué 5" },
      { start: 4, text: " A Ísodo 3" },
    ]
    const wanted = [
      { bookId: "hos", chapter: 8 },
      { bookId: "hos", chapter: 10 },
      { bookId: "jos", chapter: 5 },
      { bookId: "exo", chapter: 3 },
    ]
    const withThem = [
      ...books,
      { id: "hos", shortName: "Oseias", chapterCount: 14 },
      { id: "jos", shortName: "Josué", chapterCount: 24 },
      { id: "exo", shortName: "Êxodo", chapterCount: 40 },
    ]
    assert.deepEqual(findChapterStarts(spoken, wanted, withThem), [1, 2, 3, 4])
  })
})

describe("findChapterEnd", () => {
  const segments = [
    { start: 56.5, end: 63.8, text: " Génesis 5" },
    { start: 63.8, end: 270, text: " Este é o livro da descendência de Adão" },
    { start: 270, end: 278.4, text: " Noé gerou Sem, Cam e Jafet." },
    { start: 280.8, end: 290, text: " Génesis 6" },
    {
      start: 480,
      end: 489.9,
      text: " Noé encontrou graça aos olhos do Senhor.",
    },
    { start: 492.1, end: 500, text: " Salmo 136." },
  ]

  it("ends where the last verse's closing words are said", () => {
    assert.equal(
      findChapterEnd(segments, 56.5, 280.8, "e gerou Sem, Cam e Jafet."),
      278.4,
    )
  })

  it("looks only before the next chapter's start", () => {
    assert.equal(findChapterEnd(segments, 280.8, 492.1, "Cam e Jafet"), 492.1)
  })

  it("falls back to the next chapter's start, or nothing for the last one", () => {
    assert.equal(
      findChapterEnd(segments, 56.5, 280.8, "quinhentos anos"),
      280.8,
    )
    assert.equal(
      findChapterEnd(segments, 492.1, undefined, "o seu amor é eterno"),
      undefined,
    )
  })

  it("finds closing words split across two segments", () => {
    const split = [
      { start: 776.6, end: 779, text: " Bem diz ó minha alma o Senhor" },
      { start: 779, end: 780.5, text: " Aleluia" },
      { start: 780.5, end: 800, text: " Eu sou o Padre Miguel" },
    ]
    assert.equal(
      findChapterEnd(
        split,
        700,
        undefined,
        "Bendiz, ó minha alma, o Senhor! Aleluia!",
      ),
      780.5,
    )
  })

  it("matches two closing words when three are not said alike", () => {
    assert.equal(
      findChapterEnd(segments, 280.8, 492.1, "achou graça ao olhar do Senhor"),
      489.9,
    )
  })
})
