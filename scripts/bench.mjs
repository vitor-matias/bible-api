// Latency and throughput of one API. Usage: node bench.mjs <label> <baseUrl>
// Every request comes from a fresh client IP (the API must run with TRUST_PROXY)
// so the per-IP rate limit never applies, and uses distinct URLs so that the
// 24 h response cache does not answer for it, except in the "cached" rows.
import { performance } from "node:perf_hooks"

const label = process.argv[2]
const base = process.argv[3]
let ipCounter = 0
const headers = () => ({
  "x-forwarded-for": `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`,
})

async function once(path) {
  const t0 = performance.now()
  const res = await fetch(base + path, { headers: headers() })
  await res.arrayBuffer()
  return { ms: performance.now() - t0, status: res.status }
}

const rows = []
async function run(name, paths, concurrency) {
  const latencies = []
  let errors = 0
  let next = 0
  const t0 = performance.now()
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < paths.length) {
        const path = paths[next++]
        const r = await once(path)
        if (r.status === 200) latencies.push(r.ms)
        else errors++
      }
    }),
  )
  const seconds = (performance.now() - t0) / 1000
  latencies.sort((a, b) => a - b)
  const at = (p) => latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))] ?? NaN
  rows.push({ name, c: concurrency, n: paths.length, rps: latencies.length / seconds, p50: at(0.5), p95: at(0.95), p99: at(0.99), errors })
}

// Distinct inputs, taken from the API itself.
const books = await (await fetch(`${base}/v1/books`, { headers: headers() })).json()
const chapters = []
for (const b of books) for (let n = 1; n <= b.chapterCount; n++) chapters.push(`/v1/${b.id}/${n}`)
const words = new Set()
for (const path of [0, 1, 2, 3, 4, 5, 1000, 1100, 1200].map((i) => chapters[i])) {
  const chapter = await (await fetch(base + path, { headers: headers() })).json()
  if (!Array.isArray(chapter.verses)) continue
  for (const v of chapter.verses) for (const t of v.text) {
    for (const w of (t.normalizedText ?? "").match(/[a-z]{4,}/g) ?? []) words.add(w)
  }
}
const vocabulary = [...words]
console.log(`# ${label}: ${chapters.length} chapters, ${vocabulary.length} distinct words available`)

// Warm the process (JIT, connections) with requests that are not measured.
for (const w of vocabulary.slice(0, 5)) await once(`/v1/search?text=${w}&limit=10&page=1`)

await run("chapter, cached", Array(400).fill("/v1/gen/1"), 1)
await run("chapter, cached", Array(1000).fill("/v1/gen/1"), 16)
await run("chapter, not cached", chapters.slice(100, 400), 1)
await run("chapter, not cached", chapters.slice(400, 900), 16)
const q = (w) => `/v1/search?text=${w}&limit=10&page=1`
await run("full-text search", vocabulary.slice(10, 110).map(q), 1)
await run("full-text search", vocabulary.slice(110, 410).map(q), 16)
const s = (w) => `/v1/search?text=${w}&semantic=true&limit=10&page=1`
await run("semantic search", vocabulary.slice(410, 470).map(s), 1)
await run("semantic search", vocabulary.slice(470, 620).map(s), 8)

const f = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : "-")
console.log(`\n${"scenario".padEnd(22)} conc  reqs   req/s    p50     p95     p99  errors`)
for (const r of rows) {
  console.log(`${r.name.padEnd(22)} ${String(r.c).padStart(4)} ${String(r.n).padStart(5)} ${f(r.rps, 0).padStart(7)} ${f(r.p50, 1).padStart(6)}ms ${f(r.p95, 1).padStart(6)}ms ${f(r.p99, 1).padStart(6)}ms  ${r.errors}`)
}
