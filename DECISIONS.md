# Design decisions

Why the project is built the way it is. Each entry is a likely interview question: what I chose, what I gave up, and how I know it was the right call. Entries 1–9 are from v0.1; 10 onward are from v0.2.

## Ingestion

### 1. Use the table of contents as the source of section headings
The PDF's text has no reliable formatting cues for headings: they're ordinary title-case lines, and guessing from capitalization mislabeled many sections. The manual already lists every section in its TOC, so ingestion parses the TOC and treats those exact titles as headings.
**Catch:** the TOC has typos ("Regestered", "Fundn", "InternationalTravel"). Matching normalizes case, punctuation and spaces, then allows about one character edit per 12 characters (Levenshtein). Sections are labeled with the body's spelling.

### 2. Chunks never cross a section boundary
Citations are only useful if they point at one section. Chunking by section first, then splitting long sections into overlapping windows, keeps every chunk citable and keeps a rule that straddles a window boundary intact in at least one chunk.

### 10. Child sections carry their parent's name
"Requirements" alone is a useless citation. A heading followed directly by another heading (no body text between) is treated as a parent, so the chunk is labeled "Financial Certification: Requirements". Only the first child gets the prefix; later siblings can't be told apart from new top-level sections in this PDF's text, and a wrong parent is worse than none.

### 11. Chunk size (150 words, 30 overlap) was chosen by the eval, not by convention
v0.1 used 300-word chunks. A sweep over 300 / 150 / 100 / 60 words on the 63-question eval: 150 words raised pass rate 52% → 54% and MRR 0.73 → 0.76; going smaller didn't help further. Big list sections like Prohibited Purchases dilute a single bullet's signal; smaller chunks give each rule more weight. Caveat: the sweep ran on the offline embedder. Re-run it with real embeddings (`--max-words`), since semantic embeddings may prefer more context.

### 12. Two ingestion bugs the evals found
- **"Uber/Lyft".** Postgres's text parser reads `Uber/Lyft` as a single file-path token, so a keyword search for "uber" never matched the Rental Vehicle section. Slashes are replaced with spaces in the full-text column.
- **Hyphenated line breaks.** The PDF wraps `SGA-` / `SBT@fsu.edu` across lines, and joining lines with a space produced "SGA- SBT@fsu.edu". The chunker now rejoins a letter-hyphen at a line end without a space.
Both would have silently made some answers impossible. Neither shows up in unit tests written from imagination; both showed up the first time the eval ran against the real manual.

## Storage and retrieval

### 3. Postgres + pgvector instead of a hosted vector database
One database holds the text, metadata, vectors and the full-text index, with SQL for everything else (versions, deletes, transactions, hybrid queries). Re-ingesting a manual version is one transaction, so a half-finished ingest is never visible. The HNSW index (cosine) is what a larger corpus would need; at ~44 chunks exact search would also be fine.

### 13. Hybrid search: vector + full-text, merged with reciprocal rank fusion
Vector search matches meaning ("car" ≈ "vehicle"); keyword search matches exact tokens ("EIN", "$225", "Concur") that embeddings blur. Their scores aren't on comparable scales (cosine similarity vs. `ts_rank_cd`), so instead of a weighted sum I use RRF: each list votes `1 / (60 + rank)`. No weights to tune, and an item both searches agree on rises to the top.
**Details:** the question's words are OR-ed together (`plainto_tsquery` ANDs them, and a natural question rarely contains every word of its answer), and `ts_rank_cd` uses length normalization so long chunks don't win by size.
**Result:** MRR 0.68 → 0.73 at a similar hit rate on the offline embedder. With real embeddings the gain should be larger, because the two signals overlap less.

### 14. The embedder is recorded with each ingested manual
Vectors from different models live in different spaces; comparing them returns confident nonsense. `documents.embedder` stores the model name, and every question is embedded with the same one (`embedderByName`). Switching models means re-ingesting, enforced in code rather than remembered.

### 6. Refuse early when retrieval finds nothing relevant, but don't trust the cutoff to catch everything
If the best vector match is below the embedder's cutoff, the generator is never called: no cost, no chance of filling the gap from general knowledge. Each embedder has its own cutoff because similarity scales differ by model.
**What the data says:** `scripts/similarity-report.ts` shows that "What is the RSO funding cap at the University of Florida?" scores *higher* (0.36) than most answerable questions, because it shares words like "RSO" and "funding". No threshold separates on-topic from off-topic questions that use the manual's vocabulary. The cutoff only catches the obvious cases; refusing the rest is the LLM's job, measured by the eval's refusal rate.

## Answering

### 4. Structured output through a forced tool call
The model must answer through a `submit_answer` tool with a JSON schema (`answerable`, `answer`, `citations[{excerpt, quote}]`). Parsing free text for citations is fragile; a schema makes the output machine-checkable.

### 5. Verify every citation in code
A model can cite an excerpt that doesn't say what it claims. Each citation's quote must appear (case- and whitespace-insensitive) in the excerpt it points to, or it's dropped. An "answerable" answer that loses all its citations is downgraded to "not answered". This is the main defense against confident wrong answers, which matter here because a wrong funding answer can cost an organization money.

### 15. An extractive baseline, and a keyless mode built on it
`ExtractiveGenerator` answers by quoting the retrieved sentences that share the most words with the question. It exists for three reasons:
1. **A baseline.** "Claude scores X%" means little alone. "The no-LLM baseline scores 54% and Claude scores X%" says what the LLM is worth.
2. **CI without secrets.** The whole pipeline runs on every push with no API keys, so a retrieval regression fails the build.
3. **The app works out of the box.** The UI labels these answers as direct quotes, because a closest-match sentence can look confident and still be wrong (the baseline's refusal rate is 14%).

## Evaluation

### 8. Evals measure the behavior that matters
| Metric | Question it answers |
|---|---|
| Retrieval hit rate, MRR | Did the right section come back, and how high? |
| Citation accuracy | Did the answer cite the section the answer actually lives in? |
| Answer rate / refusal rate | Does it answer what it should, and refuse what the manual doesn't cover? |
| Fact recall | Did the answer contain the required numbers and terms? |
| Judge accuracy (optional) | Does an LLM grader agree with the reference answer? |

Pass rate requires all of them for a case. Refusal rate is separate because a system that answers everything can look good on every other number.

### 16. Deterministic checks first, an LLM judge second
`must_include` substring checks are free, fast and reproducible, but brittle ("4 to 6 weeks" vs "4–6 weeks") and blind to wrong statements that contain the right number ("at least $250"). The judge compares the answer with a reference answer and catches those, but costs money and varies between runs. Required facts are kept to short, phrasing-proof fragments, and the judge runs on demand.

### 17. The eval set is tested against the manual
`tests/eval-set.test.ts` checks every case: its expected section exists, and every required fact appears in that section's text. Without it, a typo in a case makes it impossible to pass, and the score looks worse for no reason. It caught the hyphenation bug (#12).

### 18. Every experiment is recorded
`npm run eval -- --record "what changed"` appends the scores, the commit and the configuration to `evals/history.jsonl`. The README's results table comes from that file, so each claimed improvement can be traced to a commit.

### 19. CI gates on the keyless eval, not the LLM eval
The full Claude eval costs money, varies run to run, and needs secrets, which pull requests from forks don't get. CI runs the deterministic keyless eval on every push (fail below 85% retrieval hit rate or 50% pass rate) and the full eval on demand.

## Interfaces

### 7. Dependency injection for the embedder, database and generator
`ask()` takes `{ pool, documentId, embedder, generator }`, built in one place (`src/runtime.ts`). Tests use a hash embedder and a fake generator, so the API, retrieval SQL and citation logic are tested without network calls or keys. CI runs the pgvector tests against a real Postgres service container.

### 9. MCP server
`ask_funding_manual` and `search_funding_manual` let an assistant like Claude look up funding rules while helping an officer plan an event. It shares `runtime.ts` and `pipeline.ts` with the API, so the MCP tool, the web app and the eval all exercise the same code. Dependencies are created on the first tool call, so the server starts and lists its tools even before the database is reachable.

### 24. AI is opt-in (`USE_AI`), and both copies of the manual live side by side
With `USE_AI=false` (the default) the app makes no API calls even when keys are set: offline embeddings, extractive answers. That makes the working system demoable before spending anything, and makes "what does the LLM add?" a one-setting comparison. The manual is stored once per embedder (`UNIQUE (title, version, embedder)`), and the active copy is chosen by mode, so switching never needs a re-ingest and the keyless mode can never call OpenAI by accident.

### 25. FSU look without FSU marks
The UI uses garnet and gold so it reads as part of FSU student life, but no seal, logo, wordmark or copy of fsu.edu's layout. It's an unofficial tool, and the top strip and footer say so. A page that looked like the university's own site would invite people to treat its answers as official.

### 20. The UI shows the evidence, not just the answer
Every answer shows the manual passage it came from, with the cited quote highlighted, using the same matching rule the server uses to verify citations. An officer about to spend money should be able to check the source in one glance. Passages that were searched but not cited are collapsed, and refusals are labeled.

## Packaging

### 21. One package plus a `web` workspace, not a full monorepo
The original plan had `packages/core`, `packages/db` and so on. The codebase is ~1,500 lines with one consumer per module, so separate packages would add build configuration without adding isolation. The React app is a workspace because it has its own toolchain (Vite, DOM types). Splitting out `core` becomes worth it if a second service needs it.

### 22. `tsx` at runtime instead of a compile step
The server runs TypeScript through `tsx` in production too. That's one fewer build artifact to keep in sync, at the cost of a slower cold start. At this scale it's the right trade; for a high-traffic service I'd compile to JavaScript.

### 26. Embedded Postgres (PGlite) for the zero-setup demo
`DATABASE_URL=pglite://data/pglite` runs real Postgres compiled to WebAssembly, with pgvector, inside the Node process. Same schema, same SQL, same code path; a small `DbPool` interface hides which one is behind it. It makes `npm run demo` (and the integration tests) work with only Node installed. It's single-connection and single-process, so production stays on a Postgres server.

### 23. First-boot ingest in the container
`scripts/start.sh` migrates, ingests the manual if the database has none, then starts the server. A fresh deploy needs no manual database steps, and restarts skip the ingest.
