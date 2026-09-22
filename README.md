# bible-api

A read-only REST API for a Bible translation: books, introductions, chapters,
verses, full-text search and semantic (meaning-based) search.

It runs on **any Redis-compatible server** (Redis, Valkey, Redis Stack). It uses
only plain commands: no RedisJSON and no RediSearch.

## Endpoints

| Endpoint | Returns |
|---|---|
| `GET /v1/books` (`?withChapters=true`) | Every book (with chapters and verses: about 21 MB) |
| `GET /v1/:book` | One book with its chapter titles |
| `GET /v1/:book/:chapter` | A chapter with its verses |
| `GET /v1/:book/:chapter/:verse` and `/:startVerse/:endVerse` | One verse, or a range |
| `GET /v1/intros`, `/v1/intros/:slug` | Standalone introductions |
| `GET /v1/search?text=&page=&limit=` | Full-text search |
| `GET /v1/search?text=&semantic=true` | Semantic search (at most 100 results) |
| `GET /health` | `200` when the data is loaded and the database answers, otherwise `503` |

## Setup

```bash
npm ci
cp .env.example .env   # or export the variables below
npm start              # compiles, then runs
```

| Variable | Meaning |
|---|---|
| `DB_URL` | Redis-compatible server, e.g. `redis://localhost:6379` (`rediss://` for TLS) |
| `PATH_TO_TEXTS` | Folder of USFM files. Needed to import; not needed to serve |
| `OPENAI_API_KEY` | Embeddings: every verse at import, every query at search time |
| `EMBEDDING_DIMENSIONS` | Vector size, default `512` (8 to 3072). Changing it needs a reimport |
| `PORT` | Default `3000` |
| `TRUST_PROXY` | Set behind a proxy (`true`, a hop count, or an address) so rate limits see real client IPs |
| `CORS_ORIGIN` | Comma-separated allowed origins; open to all if unset |

## Loading the data

The database must hold the Bible before the API can serve it.

- **On the same machine as the texts:** set `PATH_TO_TEXTS`. On start, if the
  database is empty the API imports it (`--reimport` forces a fresh import).
- **On a hosted service with no texts:** run `npm run import` from a machine that
  has them, with `DB_URL` pointing at the hosted database. The API waits, reports
  `loading`, and picks the data up within 15 seconds of the import finishing.

Leave `PATH_TO_TEXTS` unset on a hosted service that has no texts, so the API
waits for `npm run import`. A completion marker with no verses behind it is
ignored, so a database like that counts as empty and is imported (or waited for)
again.

The import first checks that the folder holds `.usfm` files and that OpenAI
answers, so a wrong folder or a bad key fails before anything is deleted. Then it
flushes the database and embeds every verse, one OpenAI call
per chapter: expect several minutes and a few cents. It marks itself complete
(`importComplete:v3`) only when every chapter embedded.

**Restart the API after re-importing.** The search index is loaded into memory at
startup and is not refreshed while the process runs.

## Hosting the texts

Render's Secret Files cannot hold the texts (1 MB in total, and file names must
start with a letter). Keep the USFM files in a private git repository and let the
build clone it, so they sit next to the code when the service runs. This project
uses the private GitLab at `git.crosswire.org`:

1. In the texts project's Settings → Repository → Deploy tokens, create a token
   with the `read_repository` scope.
2. On the Render service, set `TEXTS_GIT_USER` and `TEXTS_GIT_TOKEN` to the
   token's username and value.
3. Set the build command to the line below, and the start command to
   `node dist/index.js`. The last step removes the clone's `.git` folder, where
   git keeps the token, so it is not left on the running service.

   ```bash
   npm ci && npm run build && GIT_TERMINAL_PROMPT=0 git clone --depth 1 https://${TEXTS_GIT_USER}:${TEXTS_GIT_TOKEN}@git.crosswire.org/cyrille/portuguese-capuchine-translation.git texts && rm -rf texts/.git
   ```

4. Set `PATH_TO_TEXTS=texts/usfm-notes-intro`. With an empty database the service
   imports the texts itself on its first start. That takes several minutes,
   reports `loading` meanwhile, and peaks near 330 MB of memory, so a 512 MB
   instance is enough. Set the health check path only after it has finished,
   because Render cancels a deploy whose health check has not passed within
   15 minutes.

   The clone only sees what is pushed to that repository, not a local checkout's
   uncommitted changes.

To load changed texts, redeploy so the build clones again, with `--reimport` added
to the start command for that deploy (and removed afterwards, or every restart
would reimport). A reimport flushes the database first, so the API answers with
errors until it has finished.

## Health check

`GET /health` always answers, even while the data loads, and reports what it sees:

```json
{ "status": "ready", "database": "ok", "index": { "verses": 31102, "vectors": 31102 } }
```

- `status` is `loading`, `ready`, `degraded` (some embeddings are missing, still
  served) or `failed`.
- `database` is `ok` if a `PING` answers within 1.5 seconds, else `unreachable`.
  It uses the connection the API already holds and never waits to open one, so
  it stays fast while the database is down.
- `index` is what search has in memory; absent until it is loaded.

The status code is `200` for `ready` or `degraded` with the database reachable,
and `503` otherwise: point a load balancer or orchestrator at it.

On Render, set the service's health check path to `/health`. Render only routes
traffic to a deploy once the check passes, and cancels a deploy whose check has
not passed after 15 minutes, so **import the texts before the first deploy**
rather than letting the new service wait for them. At runtime, Render stops
routing to an instance after 15 seconds of failures and restarts it after 60.

## Search

Both searches run inside the API, over data it loads at startup (roughly 5 MB of
text and one vector per verse), so the database needs no search features.

- **Full-text** finds an exact phrase of whole words, ignoring case and accents.
  There is no stemming: "amor" does not match "amores". A phrase may run across
  the divine-name split in the source ("ao" then "Senhor"). Section headings and
  cross-references are searchable but never joined to the verse text; footnotes
  are not searched. Results are in verse order.
- **Semantic** embeds the query with OpenAI and ranks verses by cosine similarity.

## Sizing

With 512-dimension vectors: about 115 MB in the database, and 150 to 250 MB of RAM
in the API. `/v1/books?withChapters=true` briefly needs about 200 MB more.
Responses are cached for 24 hours in the database under `cache:` keys, and the
cache survives a redeploy: clear it after changing what an endpoint returns.

## Development

```bash
npm test                          # unit tests (Node's test runner)
npm run biome                     # lint and format
node scripts/openai-stub.mjs      # fake embeddings: no key, no cost
node scripts/bench.mjs <label> <base url>   # latency and throughput
```

To run everything locally without OpenAI, start the stub, then start the API and
the import with `OPENAI_API_KEY=stub OPENAI_BASE_URL=http://localhost:4011/v1`.
The stub returns random vectors, so semantic results are meaningless, but
everything else is real. `scripts/bench.mjs` needs the API started with
`TRUST_PROXY=true`, because it sends a different client IP with every request,
and only talks to an API on this machine (an `http://localhost:…` base URL).
