// Evaluates the semantic search this API serves, against the live index: each
// query in queries.ts is searched as typed, as the API searches it ("expanded":
// short queries rephrased by expandQuery, see rankVerses) and with every query
// rephrased, and each way is scored on the expected verses and on what the
// relevance cut keeps. The cut grid is how MIN_TOP_SIMILARITY and
// MIN_SIMILARITY in semanticSearch.ts are calibrated; rerun it after changing
// those, MAX_WORDS_TO_EXPAND, EXPANSION_SIMILARITY_DISCOUNT or the prompt.
//
// Needs Redis with the Bible imported and GOOGLE_API_KEY in .env.
//
//   npx tsc && node dist/scripts/embeddingEval/compareSearch.js

import { createClient } from "redis"
import { generateQueryEmbeddings } from "../../services/gemini/embeddings"
import { EXPANSION_MODEL, expandQuery } from "../../services/gemini/expandQuery"
import {
  cutByRelevance,
  fuseByBestSimilarity,
  KNN_MAX_RESULTS,
  knnWindow,
  MIN_SIMILARITY,
  MIN_TOP_SIMILARITY,
  type RankedVerse,
  shouldExpand,
} from "../../services/search/semanticSearch"
import { EVAL_QUERIES, NO_ANSWER_QUERIES, refToKey } from "./queries"

require("dotenv").config()

type Searched = {
  query: string
  // Verse keys; empty for a query the Bible has no answer for.
  relevant: string[]
  expansions: string[]
  expansionMs: number
  rankings: Record<Variant, RankedVerse[]>
}

const VARIANTS = [
  "typed",
  "expanded",
  "expanded-all",
  "expanded-all-rrf",
] as const
type Variant = (typeof VARIANTS)[number]

// The cut needs similarities, so only these two can be cut.
const CUT_VARIANTS: Variant[] = ["typed", "expanded", "expanded-all"]
const GATES = [0.7, 0.72, 0.74, 0.76]
const FLOORS = [0.68, 0.7, 0.72, 0.74]

// Reciprocal rank fusion, for comparison with fusing by best similarity: it
// ranks by agreement across phrasings but has no similarity scale to cut on.
const RRF_K = 60
const fuseByRank = (windows: RankedVerse[][]): RankedVerse[] => {
  const scores = new Map<string, number>()
  for (const window of windows) {
    window.forEach(({ key }, i) => {
      scores.set(key, (scores.get(key) ?? 0) + 1 / (RRF_K + i + 1))
    })
  }
  return [...scores]
    .map(([key, similarity]) => ({ key, similarity }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, KNN_MAX_RESULTS)
}

const search = async (
  client: ReturnType<typeof createClient>,
  query: string,
  relevant: string[],
): Promise<Searched> => {
  const start = Date.now()
  // A failed call searches as typed, as the API does.
  const expansions = (await expandQuery(query)) ?? []
  const expansionMs = Date.now() - start

  const vectors = await generateQueryEmbeddings([query, ...expansions])
  const windows = await Promise.all(
    vectors.map((vector) => knnWindow(client, vector)),
  )
  return {
    query,
    relevant,
    expansions,
    expansionMs,
    rankings: {
      typed: windows[0],
      expanded: shouldExpand(query)
        ? fuseByBestSimilarity(windows)
        : windows[0],
      "expanded-all": fuseByBestSimilarity(windows),
      "expanded-all-rrf": fuseByRank(windows),
    },
  }
}

// 1-based position of each expected verse, Infinity outside the window.
const ranksOf = (ranking: RankedVerse[], relevant: string[]): number[] =>
  relevant.map((key) => {
    const index = ranking.findIndex((verse) => verse.key === key)
    return index === -1 ? Number.POSITIVE_INFINITY : index + 1
  })

const recallAt = (ranks: number[], k: number): number =>
  ranks.filter((rank) => rank <= k).length / Math.min(ranks.length, k)

const mean = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

const pad = (value: string | number, width: number) =>
  String(value).padStart(width)

const formatRank = (rank: number) => (Number.isFinite(rank) ? rank : "-")

const printRankingSummary = (answerable: Searched[]) => {
  console.log(
    `\nRanking (mean over ${answerable.length} queries, top ${KNN_MAX_RESULTS} only; R@k is the share of expected verses in the first k, MRR is 1/rank of the first one found)\n`,
  )
  console.log(
    `${"".padEnd(18)}${pad("R@10", 8)}${pad("R@100", 8)}${pad("MRR", 8)}`,
  )
  for (const variant of VARIANTS) {
    const ranks = answerable.map((s) =>
      ranksOf(s.rankings[variant], s.relevant),
    )
    console.log(
      `${variant.padEnd(18)}${pad(mean(ranks.map((r) => recallAt(r, 10))).toFixed(3), 8)}${pad(mean(ranks.map((r) => recallAt(r, 100))).toFixed(3), 8)}${pad(mean(ranks.map((r) => 1 / Math.min(...r))).toFixed(3), 8)}`,
    )
  }
}

const printCutGrid = (answerable: Searched[], noAnswer: Searched[]) => {
  console.log(
    "\nRelevance cut (none when the best result is below the gate, else every result at or above the floor)",
  )
  console.log(
    "  leaked: results returned for the queries with no answer; answered: queries with any result;\n  expected: expected verses kept, of all expected; results: median kept per answerable query\n",
  )
  console.log(
    `${"".padEnd(14)}${pad("gate", 6)}${pad("floor", 7)}${pad("leaked", 8)}${pad("answered", 10)}${pad("expected", 10)}${pad("results", 9)}`,
  )
  const totalExpected = answerable.reduce((n, s) => n + s.relevant.length, 0)
  for (const variant of CUT_VARIANTS) {
    for (const gate of GATES) {
      for (const floor of FLOORS.filter((f) => f <= gate)) {
        const cut = (s: Searched) =>
          cutByRelevance(s.rankings[variant], gate, floor)
        const leaked = noAnswer.reduce((n, s) => n + cut(s).length, 0)
        const kept = answerable.map(cut)
        const answered = kept.filter((k) => k.length > 0).length
        const expected = answerable.reduce(
          (n, s, i) =>
            n +
            s.relevant.filter((key) => kept[i].some((v) => v.key === key))
              .length,
          0,
        )
        const current =
          gate === MIN_TOP_SIMILARITY && floor === MIN_SIMILARITY
            ? "  <- current"
            : ""
        console.log(
          `${variant.padEnd(14)}${pad(gate.toFixed(2), 6)}${pad(floor.toFixed(2), 7)}${pad(leaked, 8)}${pad(`${answered}/${answerable.length}`, 10)}${pad(`${expected}/${totalExpected}`, 10)}${pad(median(kept.map((k) => k.length)), 9)}${current}`,
        )
      }
    }
  }
}

const printPerQuery = (searched: Searched[]) => {
  console.log(
    `\nPer query (current cut: gate ${MIN_TOP_SIMILARITY}, floor ${MIN_SIMILARITY})`,
  )
  for (const s of searched) {
    console.log(`\n"${s.query}"  (${s.expansionMs} ms)`)
    console.log(`  expansions: ${JSON.stringify(s.expansions)}`)
    for (const variant of CUT_VARIANTS) {
      const ranking = s.rankings[variant]
      const ranks = ranksOf(ranking, s.relevant).map(formatRank).join(" ")
      const kept = cutByRelevance(ranking).length
      console.log(
        `  ${variant.padEnd(13)} best ${ranking[0]?.similarity.toFixed(3) ?? "-"}  kept ${pad(kept, 3)}${s.relevant.length > 0 ? `  expected at ${ranks}` : ""}`,
      )
    }
  }
}

const main = async () => {
  const unknown = EVAL_QUERIES.flatMap(({ relevant }) =>
    relevant.filter((ref) => !refToKey(ref)),
  )
  if (unknown.length > 0) {
    throw new Error(`Malformed references: ${unknown.join(", ")}`)
  }

  const client = createClient({
    url: process.env.DB_URL,
    socket: { reconnectStrategy: false },
  })
  // A failed connection or command already rejects its own promise; the
  // listener only keeps the event from crashing the process.
  client.on("error", () => {})
  try {
    await client.connect()
  } catch (error) {
    throw new Error(
      `Cannot reach Redis at ${process.env.DB_URL}; start it and import the Bible first (${error})`,
    )
  }

  const answerable: Searched[] = []
  const noAnswer: Searched[] = []
  try {
    console.log(
      `Expanding with ${EXPANSION_MODEL}: ${EVAL_QUERIES.length} queries with expected verses, ${NO_ANSWER_QUERIES.length} with none`,
    )
    // Sequential: the expansion latency is part of what is measured.
    for (const { query, relevant } of EVAL_QUERIES) {
      answerable.push(
        await search(
          client,
          query,
          relevant.map((ref) => refToKey(ref) as string),
        ),
      )
    }
    for (const query of NO_ANSWER_QUERIES) {
      noAnswer.push(await search(client, query, []))
    }
  } finally {
    await client.quit()
  }

  const latencies = [...answerable, ...noAnswer].map((s) => s.expansionMs)
  console.log(
    `Expansion latency: median ${median(latencies)} ms, max ${Math.max(...latencies)} ms`,
  )
  printRankingSummary(answerable)
  printCutGrid(answerable, noAnswer)
  printPerQuery([...answerable, ...noAnswer])
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
