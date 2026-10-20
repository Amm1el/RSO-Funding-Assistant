# RSO Funding Assistant

Answers Florida State University student organizations' questions about Student Government Association (SGA) funding, using only the official **2026–27 RSO Financial Manual**, and cites the section and page for every answer.

I chair SGA's RSO Allocation Committee (RSOAC), which reviews funding requests from FSU's 750+ registered student organizations. Most questions we get each week are already answered in the manual, but the manual is 18 pages and the answer is usually one line. This tool finds that line.

> Not official SGA advice. When the manual doesn't cover a question, the assistant says so instead of guessing.

## How it works

```
PDF ──► per-page text ──► section-aware chunks ──► embeddings ──► Postgres + pgvector
                                                                       │
question ──► embedding ──► top-k cosine search ──► similarity cutoff ──┘
                                     │
                                     ▼
                     Claude, forced to answer through a JSON tool schema
                                     │
                                     ▼
              citation check: every quote must appear word for word in the excerpt it cites
```

1. **Ingest** (`src/ingest/`). The manual's own table of contents is parsed and used as the list of section headings, with typo-tolerant matching because the TOC and the body don't always spell headings the same way. Chunks never cross a section boundary, so every chunk can be cited by section and page. Long sections are split into overlapping ~300-word windows.
2. **Store** (`db/schema.sql`, `src/db.ts`). Chunks and their 1536-dimension embeddings go into Postgres with pgvector, behind an HNSW cosine index. Re-ingesting a manual version replaces it in one transaction.
3. **Retrieve** (`src/pipeline.ts`). The question is embedded, the top 6 chunks are fetched, and anything below a similarity cutoff is dropped. If nothing is left, the model is never called.
4. **Answer** (`src/answer.ts`). Claude must respond through a `submit_answer` tool schema: `answerable`, `answer`, and citations (excerpt number + exact quote).
5. **Verify citations.** Quotes that don't appear in the cited excerpt are discarded. An answer that claims to be answerable but has no surviving citation is downgraded to "not answered."

## What's in the repo

| Path | What it is |
|---|---|
| `src/server.ts`, `public/index.html` | Express API (`POST /api/ask`, `GET /health`) and a small web page |
| `src/mcp.ts` | MCP server with `ask_funding_manual` and `search_funding_manual` tools, so Claude Desktop or Claude Code can use it |
| `src/cli/` | `ingest`, `ask`, `eval`, `migrate` commands |
| `evals/questions.jsonl` | 20 eval questions with expected sections and required facts, including 3 the manual can't answer |
| `tests/` | Vitest unit tests plus integration tests against a real Postgres + pgvector |
| `.github/workflows/ci.yml` | Type-check and tests on every push; full answer eval on manual trigger |
| `DECISIONS.md` | Why each design choice was made |

## Run it

Requirements: Node 20+, Docker, an OpenAI API key (embeddings) and an Anthropic API key (answers).

```bash
npm install
cp .env.example .env            # add your API keys
npm run db:up                   # Postgres + pgvector in Docker
# Download the manual into data/:
#   https://sga.fsu.edu/sites/default/files/PDFs/Accounting/26-27SGAFM.pdf
npm run ingest -- data/26-27SGAFM.pdf
npm run ask -- "What is the most our RSO can get from RSOAC this year?"
npm run dev                     # http://localhost:3000
```

No API keys yet? `npm run ingest -- data/26-27SGAFM.pdf --offline` uses a local hash embedder so you can explore the database and retrieval.

### Use it from Claude Desktop or Claude Code (MCP)

```json
{
  "mcpServers": {
    "rso-funding": { "command": "npx", "args": ["tsx", "/path/to/RSO-Funding-Assistant/src/mcp.ts"] }
  }
}
```

## Tests and evals

```bash
npm test                                                   # unit tests
TEST_DATABASE_URL=postgres://rso:rso@localhost:5432/rso_test npm test   # + pgvector integration tests
npm run eval                                               # answer quality (needs API keys)
```

The eval reports retrieval hit rate (did the expected section come back?), answerability accuracy (did it refuse exactly when it should?), fact recall (did the answer contain the required numbers?) and overall pass rate.

## Status

Version 0.1: ingestion, storage, retrieval, cited answers, web page, MCP server, tests and CI are in place. Next:

- [ ] Run the full eval with real embeddings and publish the scores here
- [ ] Replace the draft eval questions with real questions from the RSOAC inbox, each checked against the manual (`"verified": true`)
- [ ] Tune chunk size, top-k and the similarity cutoff using the eval
- [ ] Hybrid search (keyword + vector) for exact terms like "EIN" and dollar amounts
- [ ] Deploy

## Author

Ammiel Bowen · [ammielbowen.com](https://ammielbowen.com) · [LinkedIn](https://www.linkedin.com/in/ammielbowen/)
