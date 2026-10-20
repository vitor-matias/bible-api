import { verseKey } from "../../services/verse/getVerse"

// Evaluation set for compareEmbeddings and compareSearch. Each query lists the
// verses a good semantic search should rank near the top, as "BOOK
// chapter:verse" with the USFM book code. Queries are phrased the way a reader
// would ask rather than in the verses' own wording, so they measure meaning,
// not word overlap.
//
// References follow this translation's versification: the Psalms use the
// Hebrew numbering, where a title counts as verse 1 (Sl 42,6 is the refrain
// "Porque estás triste, minha alma").
export type EvalQuery = {
  query: string
  relevant: string[]
}

// "OBA 1:20" -> "verse:oba:1:20", or undefined for a malformed reference.
export const refToKey = (ref: string): string | undefined => {
  const match = /^([1-3]?[A-Z]{2,3}) (\d+):(\d+)$/.exec(ref)
  if (!match) return undefined
  const [, book, chapter, verse] = match
  return verseKey(book.toLowerCase(), Number(chapter), Number(verse))
}

// Neither word appears in the text. Finding these takes geographic knowledge:
// Spain is named outright, while Sefarad and Tarshish are traditionally placed
// in Iberia.
const IBERIA = [
  "ROM 15:24",
  "ROM 15:28",
  "1MA 8:3",
  "OBA 1:20",
  "JON 1:3",
  "ISA 66:19",
  "PSA 72:10",
]

export const EVAL_QUERIES: EvalQuery[] = [
  { query: "Portugal", relevant: IBERIA },
  { query: "Península Ibérica", relevant: IBERIA },
  {
    query: "Jesus como pastor que cuida do rebanho",
    relevant: ["JHN 10:11", "JHN 10:14", "PSA 23:1", "EZK 34:12", "LUK 15:4"],
  },
  {
    query: "devemos amar quem nos odeia",
    relevant: ["MAT 5:44", "LUK 6:27", "LUK 6:35"],
  },
  {
    query: "ansiedade",
    relevant: ["MAT 6:34", "MAT 6:25", "PHP 4:6", "1PE 5:7"],
  },
  {
    query: "acreditar sem fazer nada não serve de nada",
    relevant: ["JAS 2:17", "JAS 2:26"],
  },
  { query: "características do amor verdadeiro", relevant: ["1CO 13:4"] },
  {
    query: "a origem do universo",
    relevant: ["GEN 1:1", "JHN 1:3", "HEB 11:3", "PSA 33:6"],
  },
  {
    query: "quantas vezes tenho de perdoar a quem me magoa",
    relevant: ["MAT 18:21", "MAT 18:22", "LUK 17:4"],
  },
  {
    query: "Jesus transforma água em vinho num casamento",
    relevant: ["JHN 2:7", "JHN 2:9"],
  },
  {
    query: "Jesus perdoa uma mulher acusada de adultério",
    relevant: ["JHN 8:3", "JHN 8:7", "JHN 8:11"],
  },
  {
    query: "a conversão de São Paulo",
    relevant: ["ACT 9:3", "ACT 9:4", "ACT 22:6", "ACT 26:13"],
  },
  {
    query: "o filho que desperdiçou a herança e voltou para casa",
    relevant: ["LUK 15:13", "LUK 15:20"],
  },
  {
    query: "Jesus manda parar uma tempestade no mar",
    relevant: ["MRK 4:39", "MAT 8:26", "LUK 8:24"],
  },
  { query: "quem não trabalha não deve comer", relevant: ["2TH 3:10"] },
  { query: "preguiça", relevant: ["PRO 6:6", "PRO 6:9", "PRO 20:4"] },
  {
    query: "a vida humana é curta e passageira",
    relevant: ["JAS 4:14", "JOB 7:7", "PSA 144:4"],
  },
  { query: "naufrágio", relevant: ["ACT 27:41", "2CO 11:25"] },
  {
    query: "tristeza e depressão",
    relevant: ["PSA 42:6", "PSA 42:12", "1KI 19:4"],
  },
  {
    query: "obedecer às autoridades civis",
    relevant: ["ROM 13:1", "1PE 2:13", "TIT 3:1"],
  },
  {
    query: "o perigo de amar o dinheiro",
    relevant: ["1TI 6:10", "HEB 13:5", "LUK 12:15"],
  },
  {
    query:
      "todos são iguais perante Deus, sem distinção de raça ou condição social",
    relevant: ["GAL 3:28", "COL 3:11", "1CO 12:13"],
  },
]

// Searches the Bible has no answer for. A relevance cut is calibrated so these
// return nothing, while the queries above keep their expected verses.
export const NO_ANSWER_QUERIES = [
  "computador",
  "futebol",
  "inteligência artificial",
  "telemóvel",
  "receita de bacalhau",
  "aquecimento global",
  "criptomoedas",
  "xyz",
]
