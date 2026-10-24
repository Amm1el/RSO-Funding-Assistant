# FSU SGA Assistant

[![CI](https://github.com/Amm1el/rso-funding-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/Amm1el/rso-funding-assistant/actions/workflows/ci.yml)

Answers Florida State University students' questions about Student Government (SGA): funding, the Constitution and Statutes, elections, agencies, graduate student government (COGS), meetings and student resources. It searches everything SGA publishes, about 3,800 sources, and shows the exact passage behind every answer.

I chair SGA's RSO Allocation Committee (RSOAC), which reviews funding requests from FSU's registered student organizations. Most questions we get each week are already answered somewhere SGA has published, but that might be one line in a 16-page manual, a chapter of the Statutes, or last month's meeting agenda. This tool finds the line, cites it, and says so when the sources don't cover a question.

> Unofficial, student-built. Not official SGA advice.

![Demo: asking about Uber reimbursement, hotel limits, and parking passes](docs/demo.gif)

<sub>Recorded in keyless mode on the v0.2 single-manual build.</sub>

## What's in it

| Section | Sources |
|---|---|
| Funding & Finance | RSO Financial Manual (current edition), Statutes 800s, COGS funding code, budgets |
| Constitution & Statutes | Constitution, Student Body Statutes, Senate and branch rules |
| Elections & Judicial | Election Code (700s), Supreme Court and Elections Commission |
| Agencies & Programs | sai.fsu.edu agencies, class councils, Union Board, agency codes |
| Graduate Students (COGS) | COGS code, grants, graduate funding |
| Meetings & Legislation | CivicClerk agendas and minutes for Senate, committees and funding boards; bills and resolutions |
| Student Resources | SGA-funded services linked from sga.fsu.edu |
| Directory | 60 office and position inboxes, 190 meeting places, the next scheduled meetings |

## How it works

```
 weekly crawl (GitHub Actions) ──► corpus-data branch (JSONL)
   sga.fsu.edu + sai.fsu.edu · linked PDFs/DOCX · code books (rendered) · CivicClerk meetings
                                     │
 ingest ──► sections per chunk ──► authority weight ──► dedupe ──► embeddings + BM25 terms ──► Postgres
                                                                                         pgvector + chunk_terms
 question ──► vector search ─┐
          └─► BM25 search ───┴─► weighted rank fusion (× source authority) ──► top 6 passages
                                                                                  │
                         Claude / local model (Ollama) via JSON schema, or extractive quotes
                                                                                  │
                    citation check: every quote must appear word for word in the passage it cites
                                                                                  │
                         web UI · phone build · REST API · MCP server · eval harness
```

1. **Crawl** (`src/crawl/`). A polite crawler (robots.txt, per-host delay, honest User-Agent) runs weekly in GitHub Actions and commits its output to the `corpus-data` branch. Code books are rendered in a real browser; meetings come from CivicClerk's public API.
2. **Ingest** (`src/corpus/`). Each chunk is assigned a section (funding, elections, …) from its chapter number or URL. Each source gets an authority weight: the current manual and code beat last year's budget and old minutes. Near-duplicate editions are collapsed to the newest.
3. **Retrieve** (`src/pipeline.ts`, `src/db.ts`). Vector search plus BM25 computed in SQL over an inverted index, merged by rank and multiplied by authority. Searching one section is the default from the UI.
4. **Answer** (`src/answer.ts`, `src/ollama.ts`, `src/extractive.ts`). With AI on, Claude (or a local Ollama model) answers through a forced JSON schema with citations. With AI off, the best-matching sentences are quoted directly.
5. **Verify** citations in code. Quotes that aren't in the cited passage are dropped; an answer left with no valid citation becomes "not answered".

By default (`USE_AI=false`) nothing calls an API. To turn AI on, set `USE_AI=true` and either add `ANTHROPIC_API_KEY` (plus `OPENAI_API_KEY` for embeddings) or point `LOCAL_MODEL` at an Ollama model for free, on-device answers.

## Evaluation

79 questions in `evals/questions.jsonl`: single-fact lookups, limits and deadlines, multi-fact questions, 9 that no source answers, and 16 real questions students emailed RSOAC (paraphrased and anonymized). Each has an expected section, required facts and a reference answer. A test checks every case against the current manual, which is how the 9/21/26 policy changes were caught.

| Metric | What it measures |
|---|---|
| Pass rate | Every check below passes for the case |
| Retrieval hit rate / MRR | The section holding the answer was retrieved / how high it ranked |
| Citation accuracy | The answer cites the section the answer lives in |
| Refusal rate | Questions no source covers are refused |
| Fact recall | Required numbers and terms appear in the answer |

Keyless results (offline embedder + extractive answers), from `evals/history.jsonl`:

| Change | Sources | Pass | Retrieval hit | MRR |
|---|---|---|---|---|
| v0.2: manual only, hybrid search, 150-word chunks | 1 | 54% | 89% | 0.76 |
| v0.3 first try: every source, same retrieval | 3,777 | 16% | 36% | 0.26 |
| + authority weights + near-duplicate removal | 3,777 | 21% | 52% | 0.42 |
| + BM25 in Postgres + stemmed embedder | 3,777 | **37%** | **89%** | **0.76** |
| same, searching the Funding section | 3,777 | 41% | 91% | 0.83 |
| + 16 RSOAC inbox questions (79 cases), Funding section | 3,777 | 37% | 87% | 0.79 |

Growing the corpus 3,800× without losing retrieval quality is the main result of v0.3. The low pass rate is the extractive baseline's ceiling: it quotes sentences and can't tell when a question is off-topic (refusal 0–11%). Real student questions are harder still (2 of 16 pass) because students describe their situation instead of using the manual's terms. Closing those gaps is what the LLM answerer is for. **Next row:** `npm run eval -- --judge --record "..."` with AI on.

CI pulls the crawled corpus, ingests it, and fails below 80% retrieval hit rate or 30% pass rate. The AI eval runs on demand (Actions → CI → Run workflow).

## Run it

**On a phone, nothing to install:** `npm run build:static` packs the corpus (meetings from the last 6 months) into one ~7 MB HTML file that runs the whole keyless pipeline in the browser.

**On a computer (Node 22, no Docker, no keys):** on Windows, double-click `start-windows.bat`. Anywhere else, run `npm install && npm run demo`. It pulls the latest crawl, loads it into an embedded Postgres (PGlite), and opens http://localhost:3000.

**Full setup** (real Postgres in Docker, as in CI and production):

```bash
npm install
cp .env.example .env              # AI is off by default (USE_AI=false)
npm run db:up                     # Postgres + pgvector in Docker
npm run corpus:pull               # the latest weekly crawl -> data/corpus
npm run ingest:corpus             # ~5 min for 26,000 chunks
npm run build && npm start        # http://localhost:3000
```

Other commands:

```bash
npm run ask -- "What is the most our RSO can get from RSOAC this year?"
npm run crawl                     # crawl it yourself (needs access to sga.fsu.edu)
npm run dev & npm run dev:web     # API with reload + UI with hot reload on :5173
npm test                          # unit tests; set TEST_DATABASE_URL for pgvector integration tests
npm run eval -- --collection funding --record "what I changed"
npx tsx scripts/check-examples.ts # every example question in the UI, through the pipeline
```

### Use it from Claude Desktop or Claude Code (MCP)

Two tools: `ask_sga` (cited answer) and `search_sga` (passages only), each with an optional `section`.

```json
{
  "mcpServers": {
    "fsu-sga": {
      "command": "/path/to/rso-funding-assistant/node_modules/.bin/tsx",
      "args": ["/path/to/rso-funding-assistant/src/mcp.ts"]
    }
  }
}
```

`npx tsx scripts/mcp-smoke.ts "your question"` starts the server the same way and calls both tools.

## Deploy

One Docker image plus Postgres with pgvector. Step-by-step for Render + Neon (free) and AWS App Runner + RDS: [docs/DEPLOY.md](docs/DEPLOY.md).

## Repo map

| Path | What it is |
|---|---|
| `src/crawl/`, `.github/workflows/crawl.yml` | Crawler: robots, fetcher, HTML, documents, code books, CivicClerk |
| `src/corpus/` | Sections, chunking, authority weights, dedupe, directory, ingest |
| `src/ingest/` | Manual-specific PDF parsing: TOC-guided sections |
| `src/db.ts`, `db/schema.sql` | Schema, vector search, BM25 over `chunk_terms` |
| `src/pipeline.ts`, `src/fusion.ts` | Retrieval and `ask()` |
| `src/answer.ts`, `src/ollama.ts`, `src/extractive.ts` | Claude and local-model answerers with citation checks; no-LLM baseline |
| `src/runtime.ts` | Picks the embedder and answerer; shared by API, MCP, CLI and evals |
| `src/server.ts`, `web/` | Express API and React UI (also builds as a single-file phone app) |
| `src/mcp.ts` | MCP server |
| `src/evals.ts`, `src/judge.ts`, `src/cli/eval.ts`, `evals/` | Eval set, scoring, LLM judge, score history |
| `tests/` | 140 tests: unit, crawler, pgvector integration, MCP client, eval set vs. manual |
| `DECISIONS.md` | Every design trade-off and the evidence behind it |
| `docs/WALKTHROUGH.md` | How to learn this codebase well enough to defend it |

## Roadmap

- [ ] Run the eval with AI on and add the row above
- [ ] RSOAC review of the draft eval cases (`"verified": true`), especially the inbox ones
- [ ] OCR for the 213 scanned PDFs that have no text layer
- [ ] Deploy (docs/DEPLOY.md) and link it here
- [ ] "What changed?" between manual editions, from the crawl history

## Author

Ammiel Bowen · [ammielbowen.com](https://ammielbowen.com) · [LinkedIn](https://www.linkedin.com/in/ammielbowen/)
