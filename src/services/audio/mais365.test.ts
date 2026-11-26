import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  type BookName,
  findChapterEnd,
  findChapterOpening,
  findChapterStarts,
  findReadingStart,
  findTitle,
  losesWords,
  mergePlan,
  parseReadings,
  pastHeadingPause,
} from "./mais365"

const books: BookName[] = [
  { id: "gen", shortName: "Génesis", chapterCount: 50 },
  { id: "job", shortName: "Job", chapterCount: 42 },
  { id: "psa", shortName: "Salmos", chapterCount: 150 },
  { id: "pro", shortName: "Provérbios", chapterCount: 31 },
  { id: "est", shortName: "Ester", chapterCount: 10 },
  { id: "luk", shortName: "Lucas", chapterCount: 24 },
  { id: "mat", shortName: "Mateus", chapterCount: 28 },
  { id: "zec", shortName: "Zacarias", chapterCount: 14 },
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

  // Dia 270: Whisper heard "Zacarias 8" as "Ascarias 8".
  it("takes a heading Whisper misheard as it often does", () => {
    assert.deepEqual(
      findChapterStarts(
        [
          { start: 637.8, text: " Zacarias 7" },
          { start: 762.3, text: " Ascarias 8" },
        ],
        [
          { bookId: "zec", chapter: 7 },
          { bookId: "zec", chapter: 8 },
        ],
        books,
      ),
      [637.8, 762.3],
    )
  })

  // Dia 262: "Mateus 16" never heard; "capítulo 16" in the commentary after
  // the readings was taken for it, and Mateus 17 and Provérbios 19 after it.
  it("leaves a heading unheard once a later reading's comes first", () => {
    const day262 = [
      { start: 293.2, text: " Mateus 15" },
      { start: 831.2, text: " Mateus 17" },
      { start: 1064.7, text: " Provérbios 19" },
      { start: 1148.4, text: " nestes capítulos" },
      { start: 1411.8, text: " 16" },
      { start: 1600, text: " Mateus 17 diz-nos" },
    ]
    assert.deepEqual(
      findChapterStarts(
        day262,
        [
          { bookId: "mat", chapter: 15 },
          { bookId: "mat", chapter: 16 },
          { bookId: "mat", chapter: 17 },
          { bookId: "pro", chapter: 19, verses: [9, 12] },
        ],
        books,
      ),
      [293.2, undefined, 831.2, 1064.7],
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

  // Dia 20: "…e vamos ouvir Génesis 38" | "Jó 29 e 30" | "Provérbios 3, 28 a 32".
  it("takes no heading from the day's announcement of its readings", () => {
    const announced = [
      { start: 47.2, text: " e vamos ouvir Génesis 38" },
      { start: 49.5, text: " Jó 29 e 30" },
      { start: 59, text: " Naquele tempo, Judá apartou-se dos seus irmãos" },
      { start: 300, text: " Jó 29" },
    ]
    assert.deepEqual(
      findChapterStarts(announced, [{ bookId: "job", chapter: 29 }], books),
      [300],
    )
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

  it("hears the text's 'Ámen' as Whisper's 'Amém', and leaves out a stanza's letter", () => {
    const psalm = [
      { start: 690, end: 695, text: " Bendito seja o Senhor, Deus de Israel," },
      { start: 695, end: 700, text: " desde agora e para sempre. Amém. Amém." },
    ]
    assert.equal(
      findChapterEnd(psalm, 690, undefined, "para sempre. Ámen! Ámen!"),
      700,
    )
    assert.equal(
      findChapterEnd(psalm, 690, undefined, "para sempre. Amém! \n Het"),
      700,
    )
  })

  it("ends at the words before a misheard last one", () => {
    const said = [
      { start: 869, end: 872, text: " conduziste o teu povo como um rebanho" },
      { start: 872.5, end: 875, text: " pela mão de Moisés e de Arão" },
    ]
    assert.equal(
      findChapterEnd(said, 860, undefined, "pela mão de Moisés e de Aarão."),
      875,
    )
  })

  // Deuteronómio 22: verses 19 and 29 close alike; the 29th went unheard.
  it("takes the next chapter's start over closing words said long before it", () => {
    const repeated = [
      {
        start: 540,
        end: 544.7,
        text: " e não poderá repudiá-la em toda a sua vida.",
      },
      { start: 545.5, end: 637, text: " Mas se a acusação for verdadeira" },
      { start: 641.3, end: 650, text: " Oração de um aflito" },
    ]
    assert.equal(
      findChapterEnd(
        repeated,
        384,
        641.3,
        "Não poderá repudiá-la em toda a sua vida.",
      ),
      641.3,
    )
  })
})

describe("findChapterOpening", () => {
  const segments = [
    { start: 600, text: " e ela tornar-se-á a sua mulher porque abusou dela." },
    { start: 641.3, text: " Oração de um aflito que na sua miséria" },
    { start: 656, text: " Senhor, escuta a minha oração" },
  ]

  it("starts a chapter read without its heading where its first verse is said", () => {
    assert.equal(
      findChapterOpening(
        segments,
        384,
        undefined,
        "Oração de um aflito que, na sua miséria, expõe a sua angústia",
      ),
      641.3,
    )
  })

  it("finds the words after a misheard first one", () => {
    const misheard = [
      { start: 232.2, text: " Ao todo, 31 reis." },
      { start: 239, text: " Jusué estava velho, avançado em anos." },
    ]
    assert.equal(
      findChapterOpening(
        misheard,
        50,
        546,
        "Josué estava velho, avançado em anos, e o Senhor disse-lhe",
      ),
      239,
    )
  })

  it("finds nothing outside its window", () => {
    assert.equal(
      findChapterOpening(segments, 384, 641, "Oração de um aflito que na sua"),
      undefined,
    )
  })
})

describe("findTitle", () => {
  it("starts a numbered book's name at its number", () => {
    const named = [
      { start: 100.2, text: " 2" },
      { start: 100.6, text: " Reis" },
      { start: 101.2, text: " 3," },
      { start: 102.0, text: " 1" },
      { start: 102.3, text: " a" },
      { start: 102.5, text: " 7" },
      { start: 104.0, text: " Josafá" },
    ]
    assert.equal(findTitle(named, 100.2, 104, 3)?.start, 99.85)
  })

  // Dia 14: "Provérbios 3, 1 a 4" before Provérbios 3:1.
  const words = [
    { start: 871.9, text: " Provérbios" },
    { start: 872.8, text: " 3," },
    { start: 873.6, text: " 1" },
    { start: 873.9, text: " a" },
    { start: 874.1, text: " 4" },
    { start: 875.8, text: " Meu" },
  ]

  it("says where the chapter's name starts and ends, before the verses named", () => {
    assert.deepEqual(findTitle(words, 871.82, 875.8, 3), {
      start: 871.55,
      end: 873.45,
    })
  })

  // Dia 6: the heading's segment, heard as "1 a 7", starts after the name.
  it("finds a name said before the heading's segment, and a verse 1 after it", () => {
    const dia6 = [
      { start: 764.84, text: " grande." },
      { start: 769.32, text: " Provérbios" },
      { start: 770.1, text: " 1" },
      { start: 770.98, text: " 1" },
      { start: 771.42, text: " a" },
      { start: 771.68, text: " 7" },
      { start: 773.22, text: " Provérbios" },
    ]
    assert.deepEqual(findTitle(dia6, 770.76, 773.22, 1), {
      start: 768.97,
      end: 770.83,
    })
  })

  // Dia 9: the segment starts on the reading before, 5 s ahead of the name.
  it("starts at the name, not at the reading before it in the segment", () => {
    const dia9 = [
      { start: 969.04, text: " não" },
      { start: 969.36, text: " subsistirá" },
      { start: 974.54, text: " Provérbios" },
      { start: 975.2, text: " 2," },
      { start: 975.94, text: " 1" },
      { start: 976.24, text: " a" },
      { start: 976.58, text: " 5" },
    ]
    assert.equal(findTitle(dia9, 969.24, 978.14, 2)?.start, 974.19)
  })

  it("finds nothing for a heading that names no verses, or another chapter", () => {
    assert.equal(findTitle(words.slice(0, 2), 871.82, 875.8, 3), undefined)
    assert.equal(findTitle(words, 871.82, 875.8, 4), undefined)
  })
})

describe("findReadingStart", () => {
  // Dia 154: Whisper lost Marcos 1:1-3, its words timed from verse 4 on.
  const segments = [
    { start: 40.1, end: 49.2, text: " E agora a leitura." },
    { start: 49.72, end: 50.76, text: " Marcos 1" },
    { start: 52.84, end: 77.12, text: " João Batista apareceu no deserto" },
  ]

  it("begins after a heading said on its own", () => {
    assert.equal(findReadingStart(segments, 49.76, 1), 52.84)
  })

  it("keeps the heading's start when it runs on into the text", () => {
    const runOn = [{ start: 49.72, text: " Marcos 1 Princípio do Evangelho" }]
    assert.equal(findReadingStart(runOn, 49.76, 1), 49.76)
  })

  it("keeps the heading's start for another chapter's number", () => {
    assert.equal(findReadingStart(segments, 49.76, 2), 49.76)
  })
})

describe("pastHeadingPause", () => {
  // Dia 161: «Marcos 16» unheard, then a pause, then «Passado o sábado».
  const pauses: [number, number][] = [
    [381.51, 382.66],
    [383.58, 383.91],
  ]

  it("moves verse 1 out of the heading, to the pause's end", () => {
    const verses: [number, number][] = [
      [1, 380.96],
      [2, 389.98],
    ]
    assert.deepEqual(pastHeadingPause(verses, 379.66, pauses), [
      [1, 382.56],
      [2, 389.98],
    ])
  })

  it("leaves verse 1 already after the pause", () => {
    const verses: [number, number][] = [
      [1, 382.6],
      [2, 389.98],
    ]
    assert.equal(pastHeadingPause(verses, 379.66, pauses), verses)
  })

  it("leaves it when the pause is too late to end a heading", () => {
    const verses: [number, number][] = [
      [1, 380.96],
      [2, 389.98],
    ]
    assert.equal(pastHeadingPause(verses, 377, pauses), verses)
  })

  // 1 Crónicas 1: «Adão, Set, Enós,», verses shorter than the pause's wait.
  it("never takes verse 1 past verse 2", () => {
    const verses: [number, number][] = [
      [1, 295.96],
      [2, 299.05],
    ]
    assert.equal(pastHeadingPause(verses, 295.96, [[298.4, 299.5]]), verses)
  })
})

describe("losesWords", () => {
  // Dia 154: Marcos 1:1-4 read in 24 s, heard as verse 4's 16 words.
  const lost =
    " João Batista apareceu no deserto a pregar um batismo de arrependimento para a remissão dos pecados."

  it("finds a long stretch heard as too few words", () => {
    assert.equal(
      losesWords([{ start: 52.84, end: 77.12, text: lost }], 49.76, 373.82),
      true,
    )
  })

  it("passes a stretch read at its pace", () => {
    const read = `${lost} ${lost} ${lost}`
    assert.equal(
      losesWords([{ start: 52.84, end: 77.12, text: read }], 49.76, 373.82),
      false,
    )
  })

  it("looks only within the reading", () => {
    assert.equal(
      losesWords([{ start: 52.84, end: 77.12, text: lost }], 100, 373.82),
      false,
    )
  })
})

describe("mergePlan", () => {
  const before = {
    chapters: {
      "mrk/1": [{ day: 154, start: 49.76 }],
      "mrk/3": [{ day: 155, start: 51.3 }],
      "pro/3": [
        { day: 14, start: 871.82 },
        { day: 15, start: 1021.24 },
      ],
    },
    days: [{ day: 14 }, { day: 15 }, { day: 154 }, { day: 155 }],
  }

  it("replaces the days run again and keeps the rest", () => {
    const run = {
      chapters: {
        "mrk/1": [{ day: 154, start: 50 }],
        "pro/3": [{ day: 14, start: 872 }],
      },
      days: [{ day: 14 }, { day: 154 }],
    }
    const merged = mergePlan(before, run)
    assert.deepEqual(merged.chapters["mrk/1"], [{ day: 154, start: 50 }])
    assert.deepEqual(merged.chapters["mrk/3"], [{ day: 155, start: 51.3 }])
    assert.deepEqual(
      merged.chapters["pro/3"].map((entry) => entry.day).sort(),
      [14, 15],
    )
    assert.deepEqual(
      merged.days.map((day) => day.day).sort((a, b) => a - b),
      [14, 15, 154, 155],
    )
  })

  it("keeps the chapters in their order", () => {
    const run = {
      chapters: { "mrk/1": [{ day: 154, start: 50 }] },
      days: [{ day: 154 }],
    }
    assert.deepEqual(Object.keys(mergePlan(before, run).chapters), [
      "mrk/1",
      "mrk/3",
      "pro/3",
    ])
  })

  // The full run merges into an empty plan: a day that failed partway
  // leaves no chapter listing it, as the day itself isn't written.
  it("leaves out a failed day's timings from a full run", () => {
    const merged = mergePlan(
      { chapters: {}, days: [] },
      {
        chapters: {
          "mrk/1": [{ day: 154, start: 50 }],
          "mrk/3": [{ day: 155, start: 60 }],
        },
        days: [{ day: 154 }],
      },
    )
    assert.deepEqual(merged.chapters, { "mrk/1": [{ day: 154, start: 50 }] })
    assert.deepEqual(merged.days, [{ day: 154 }])
  })

  it("keeps a day that failed partway as it was", () => {
    const run = {
      chapters: { "mrk/3": [{ day: 155, start: 60 }] },
      days: [],
    }
    assert.deepEqual(mergePlan(before, run).chapters["mrk/3"], [
      { day: 155, start: 51.3 },
    ])
  })

  it("drops a chapter a day no longer reads", () => {
    const merged = mergePlan(before, { chapters: {}, days: [{ day: 155 }] })
    assert.equal(merged.chapters["mrk/3"], undefined)
  })
})
