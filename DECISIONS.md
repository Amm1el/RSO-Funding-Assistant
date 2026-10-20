# Design decisions

Short notes on why the project is built the way it is. Each one is a likely interview question.

## 1. Use the table of contents as the source of section headings
The PDF's text has no reliable formatting cues for headings: they're ordinary title-case lines. Guessing from capitalization mislabeled many sections. The manual already lists every section in its TOC, so ingestion parses the TOC and treats those exact titles as headings.
**Catch:** the TOC has typos ("Regestered", "Fundn", "InternationalTravel"). Matching normalizes case, punctuation and spaces, then allows about one character edit per 12 characters (Levenshtein). Sections are labeled with the body's spelling.

## 2. Chunks never cross a section boundary
Citations are only useful if they point at one section. Chunking by section first, then splitting long sections into ~300-word windows with 50 words of overlap, keeps every chunk citable and keeps a rule that straddles a window boundary intact in at least one chunk.

## 3. Postgres + pgvector instead of a hosted vector database
One database holds the text, metadata and vectors, with SQL for everything else (versions, deletes, transactions). Re-ingesting a manual version is a single transaction: delete the old version, insert the new one, so a half-finished ingest is never visible. The HNSW index with cosine distance gives fast approximate search; at ~30 chunks exact search would also be fine, but the index is what a larger corpus needs.

## 4. Structured output through a forced tool call
The model must answer through a `submit_answer` tool with a JSON schema (`answerable`, `answer`, `citations[{excerpt, quote}]`). Parsing free text for citations is fragile; a schema makes the output machine-checkable.

## 5. Verify every citation in code
A model can cite an excerpt that doesn't say what it claims. Each citation's quote must appear (case- and whitespace-insensitive) inside the excerpt it points to, or it's dropped. If an "answerable" answer loses all its citations, it's downgraded to "not answered." This is the main defense against confident wrong answers, which matter here because a wrong funding answer can cost an organization money.

## 6. Refuse early when retrieval finds nothing relevant
If no chunk clears the similarity cutoff, the model isn't called at all. That saves cost and removes the chance of the model filling the gap from general knowledge. The cutoff (0.25) is a starting point to tune with the eval set.

## 7. Dependency injection for the embedder, database and model
`ask()` takes `{ pool, embedder, generator }`. Tests use a deterministic hash embedder and a fake generator, so the API, retrieval SQL and citation logic are tested without network calls or API keys. CI runs the pgvector integration tests against a real Postgres service container.

## 8. Evals measure the behavior that matters
Four numbers: retrieval hit rate, answerability accuracy (including questions the manual can't answer), fact recall for required numbers, and overall pass rate. The eval set starts as drafts written from the manual; the plan is to replace them with real questions RSOAC receives, each verified, which is data a typical student project doesn't have.

## 9. MCP server
Exposing `ask_funding_manual` and `search_funding_manual` over MCP lets an assistant like Claude look up funding rules while helping an officer plan an event, without a custom integration.
