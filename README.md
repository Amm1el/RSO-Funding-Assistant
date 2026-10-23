# RSO Funding Assistant

[![CI](https://github.com/Amm1el/rso-funding-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/Amm1el/rso-funding-assistant/actions/workflows/ci.yml)

Answers Florida State University student organizations' questions about Student Government Association (SGA) funding, using only the official **2026–27 RSO Financial Manual**, and shows the exact passage behind every answer.

I chair SGA's RSO Allocation Committee (RSOAC), which reviews funding requests from FSU's registered student organizations. Most questions we get each week are already answered in the manual, but the answer is usually one line in 16 pages. This tool finds that line, cites it, and says so when the manual doesn't cover a question.

> Not official SGA advice.

![Demo: asking about Uber reimbursement, hotel limits, and parking passes](docs/demo.gif)

<sub>Recorded in keyless mode (offline retrieval, direct-quote answers). Re-record with `scripts/record-demo.ts` once API keys are set.</sub>

## How it works

```
                 ┌──────────── ingest (once per manual edition) ────────────┐
 manual PDF ──► per-page text ──► TOC-guided sections ──► 150-word chunks ──► embeddings ──► Postgres
                                                                                             pgvector + full-text
 question ──► embed ──► vector search ─┐
          └──────────► keyword search ─┴─► reciprocal rank fusion ──► top 6 passages
                                                                          │
                                       Claude, forced to answer through a JSON tool schema
                                                                          │
                     citation check: every quote must appear word for word in the passage it cites
                                                                          │
                              web UI  ·  REST API  ·  MCP server  ·  eval harness
```

1. **Ingest** (`src/ingest/`). The manual's table of contents is the list of section headings, matched with typo tolerance because the TOC and body spell some headings differently. Chunks never cross a section boundary, so every chunk can be cited by section and page.
2. **Store** (`db/schema.sql`). Chunks, 1536-dimension embeddings (HNSW cosine index) and a generated full-text column (GIN index) in one Postgres table. The embedding model is recorded with each manual so questions always use the same one.
3. **Retrieve** (`src/pipeline.ts`). Vector and keyword results are merged with reciprocal rank fusion. If even the best vector match is below the model's cutoff, the question is refused without calling the LLM.
4. **Answer** (`src/answer.ts`). Claude answers through a `submit_answer` tool schema: `answerable`, `answer`, and citations (passage number + exact quote).
5. **Verify** citations in code. Quotes that don't appear in the cited passage are dropped; an answer left with no valid citation becomes "not answered".

By default (`USE_AI=false`) the same pipeline runs with no API calls: an offline embedder and an extractive answerer that quotes the best-matching sentences. That's also the eval baseline. To turn AI on, add `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` to `.env`, set `USE_AI=true`, and run `npm run ingest` once; the offline copy of the manual is kept, so you can switch back and forth by changing one line.

## Evaluation

63 questions in `evals/questions.jsonl`: 26 single-fact lookups, 20 limits/amounts/deadlines, 10 multi-fact, and 7 the manual can't answer. Each has an expected section, required facts, and a reference answer. A test checks every case against the real manual, so a typo can't make a case impossible to pass.

| Metric | What it measures |
|---|---|
| Pass rate | Every check below passes for the case |
| Retrieval hit rate / MRR | The section holding the answer was retrieved / how high it ranked |
| Citation accuracy | The answer cites the section the answer lives in |
| Refusal rate | Questions the manual doesn't cover are refused |
| Fact recall | Required numbers and terms appear in the answer |

Results so far (from `evals/history.jsonl`, offline embedder + extractive answers):

| Change | Pass | Retrieval hit | MRR | Citation acc. | Refusal |
|---|---|---|---|---|---|
| v0.1 setup: 300-word chunks, vector search | 51% | 91% | 0.68 | 79% | 14% |
| + hybrid search (vector + full-text, RRF) | 52% | 89% | 0.73 | 80% | 14% |
| + 150-word chunks | **54%** | 89% | **0.76** | **82%** | 14% |

The 14% refusal rate is the point of the baseline: word overlap can't tell that "What's the funding cap at the University of Florida?" is off-topic. Closing that gap is what the LLM is for. **Next row:** the same eval with OpenAI embeddings and Claude (`npm run eval -- --judge --record "..."`).

CI runs the keyless eval on every push and fails below 85% retrieval hit rate or 50% pass rate. The Claude eval runs on demand (Actions → CI → Run workflow).

## Run it

**Quickest (no Docker, no API keys, just Node 22):** on Windows, double-click `start-windows.bat`. Anywhere else, run `npm install && npm run demo`. It downloads the manual, builds the UI, loads everything into an embedded Postgres (PGlite, with pgvector) under `data/pglite`, and opens http://localhost:3000. Later runs start in a few seconds.

**Full setup** (real Postgres in Docker, the setup used in CI and production):

Requirements: Node 22, Docker. API keys are optional, and unused until you set `USE_AI=true`.

```bash
npm install
cp .env.example .env              # AI is off by default (USE_AI=false)
npm run db:up                     # Postgres + pgvector in Docker
curl -fsSL -o data/26-27SGAFM.pdf https://sga.fsu.edu/sites/default/files/PDFs/Accounting/26-27SGAFM.pdf
npm run ingest -- data/26-27SGAFM.pdf
npm run build && npm start        # http://localhost:3000
```

Other commands:

```bash
npm run ask -- "What is the most our RSO can get from RSOAC this year?"
npm run dev & npm run dev:web     # API with reload + UI with hot reload on :5173
npm test                          # unit tests; set TEST_DATABASE_URL for pgvector integration tests
npm run eval -- --record "what I changed"
docker compose --profile app up --build   # the production image
```

### Use it from Claude Desktop or Claude Code (MCP)

Two tools: `ask_funding_manual` (cited answer) and `search_funding_manual` (passages only).

```json
{
  "mcpServers": {
    "rso-funding": {
      "command": "/path/to/rso-funding-assistant/node_modules/.bin/tsx",
      "args": ["/path/to/rso-funding-assistant/src/mcp.ts"]
    }
  }
}
```

`npx tsx scripts/mcp-smoke.ts "your question"` starts the server the same way and calls both tools.

## Deploy

One Docker image plus Postgres with pgvector; the container ingests the manual on first boot. Step-by-step for Render + Neon (free) and AWS App Runner + RDS: [docs/DEPLOY.md](docs/DEPLOY.md).

## Repo map

| Path | What it is |
|---|---|
| `src/ingest/` | PDF text, TOC parsing, section-aware chunking |
| `src/db.ts`, `db/schema.sql` | Schema, vector search, full-text search |
| `src/pipeline.ts` | Retrieval (hybrid + RRF) and `ask()` |
| `src/answer.ts`, `src/extractive.ts` | Claude answerer with citation checks; no-LLM baseline |
| `src/runtime.ts` | Picks the embedder and answerer; shared by API, MCP, CLI and evals |
| `src/server.ts`, `web/` | Express API and React UI |
| `src/mcp.ts` | MCP server |
| `src/evals.ts`, `src/judge.ts`, `src/cli/eval.ts`, `evals/` | Eval set, scoring, LLM judge, score history |
| `tests/` | 101 tests: unit, pgvector integration, MCP client, eval set vs. manual |
| `DECISIONS.md` | Every design trade-off and the evidence behind it |
| `docs/WALKTHROUGH.md` | How to learn this codebase well enough to defend it |

## Roadmap

- [ ] Run the eval with OpenAI embeddings + Claude and add the row above
- [ ] Verify the 63 draft eval cases against real RSOAC decisions (`"verified": true`) and add real inbox questions
- [ ] Re-run the chunk-size sweep with real embeddings
- [ ] Deploy (docs/DEPLOY.md) and link it here
- [ ] Load 2025–26 alongside 2026–27 and answer "what changed?"

## Author

Ammiel Bowen · [ammielbowen.com](https://ammielbowen.com) · [LinkedIn](https://www.linkedin.com/in/ammielbowen/)
