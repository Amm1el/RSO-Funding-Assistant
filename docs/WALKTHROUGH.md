# Walkthrough: understand this project well enough to defend it

Work through this before listing the project anywhere. For each step, read the files, run the command, then answer the questions out loud without looking. Do the exercise yourself; that's the part an interviewer can tell you did.

## 0. Run it
- `npm run db:up`, `npm run corpus:pull`, `npm run ingest:corpus`, `npm run build && npm start`, then ask five questions in the UI, in different sections.
- Open `/health`. Which embedder and generator are live, and why those?

## 0.5 The crawl: `src/crawl/`, `.github/workflows/crawl.yml`, `data/corpus/crawl-report.md`
- Read `crawl-report.md`. How many sources of each kind, and why did 261 fail? (Most are scanned PDFs with no text layer.)
- How does `robots.ts` decide between an Allow and a Disallow that both match? Why a per-host delay?
- Why does the crawler render code books in a browser instead of calling the JSON endpoints the page uses? (DECISIONS #28)
- Why does the crawl run in GitHub Actions and write to a separate branch?

## 0.6 From documents to a usable corpus: `src/corpus/`
- Pick a Statutes chapter and an agency PDF. Which section does each chunk land in, and which rule decided it (`collections.ts`)?
- Compute `sourceWeight` by hand for this year's manual, last year's budget, and a 2023 minutes PDF.
- Explain the v0.3 collapse (16% pass) and the three fixes that brought retrieval back (DECISIONS #30–32), with the numbers.
- **Exercise:** find a question where an old document still outranks the current rule. Fix it with a weight or a dedupe rule, and record the eval.

## 1. Ingestion: `src/ingest/chunk.ts`
- `npx tsx scripts/dump-pages.ts` and compare with `SELECT section, page_start, left(content, 80) FROM chunks ORDER BY ordinal;`
- Why parse the table of contents instead of detecting headings by formatting? What does `matchHeading` tolerate, and why "one edit per 12 characters"?
- How does a child section get its parent's name? Which sections get it and which don't?
- What two bugs did the eval find in ingestion (DECISIONS #12)? Explain each in one sentence.
- **Exercise:** the "Last chance to spend funds" deadline (May 15) is buried in "Financial Certification: Requirements". Detect sub-headings that aren't in the TOC (short line, no ending punctuation, followed by body text) and label them, then show the effect with `npm run eval -- --record`.

## 2. Storage and search: `db/schema.sql`, `src/db.ts`, `src/pipeline.ts`
- What does `vector(1536)` mean? What does `<=>` compute, and why is similarity `1 - distance`?
- Read `keywordSearch` in `src/db.ts`. Map each part of the SQL to the BM25 formula (idf, tf saturation with k1, length normalization with b). Why did `ts_rank_cd` stop being good enough at 26,000 chunks?
- Walk through `retrieve()`: vector search, the cutoff, BM25, weighted rank fusion. Why fuse ranks instead of adding the two scores, and where does authority come in?
- Why is the embedder stored on `documents`? What breaks without it?
- **Exercise:** run `npx tsx scripts/similarity-report.ts`. Explain why no cutoff separates the answerable and unanswerable questions.

## 3. Answering: `src/answer.ts`, `src/extractive.ts`
- Why force a tool call instead of asking for JSON in the prompt?
- What exactly does `validateCitations` check? Give an answer it would reject.
- What is the extractive generator for, if it's worse than Claude? (Three reasons, DECISIONS #15.)

## 4. Evals: `src/evals.ts`, `src/cli/eval.ts`, `evals/`
- What does each metric tell you that pass rate doesn't? Why is refusal rate separate?
- Why does `tests/eval-set.test.ts` exist?
- Why does CI gate on the keyless eval instead of the Claude eval?
- Four cases broke when SGA updated the manual on 9/21/26. What changed in the manual, and how did the test catch it (DECISIONS #34)?
- **Exercise (most valuable):** go through `evals/questions.jsonl` as the RSOAC chair, starting with the 16 `"origin": "rsoac-inbox"` cases. Fix anything wrong and set `"verified": true`. Then turn AI on (a Claude key, or Ollama for free), re-ingest, and run `npm run eval -- --collection funding --judge --record "..."`. How many inbox questions pass now? Put the new row in the README.

## 5. Interfaces: `src/server.ts`, `web/src/App.tsx`, `src/mcp.ts`
- What does the zod schema on `/api/ask` reject? What does the UI do with `passages`?
- How does the UI find the quote inside the passage, and why must it use the same rule as the server?
- Connect the MCP server to Claude Desktop and ask it to plan a trip budget for 12 students. Which tool did it call?

## 6. Shipping: `Dockerfile`, `scripts/start.sh`, `.github/workflows/ci.yml`, `docs/DEPLOY.md`
- What happens on the container's first boot? On the second?
- What runs in CI on every push, and what only on demand?
- **Exercise:** deploy with docs/DEPLOY.md and put the link in the README.

## Questions to expect in an interview
1. How do you stop the model from making things up? (Retrieval cutoff, forced schema, citation verification, refusal eval.)
2. How did you choose chunk size, and how would you know if it's wrong?
3. Why hybrid search? Show me a question it fixed.
4. What's your eval score, what's the baseline, and what's the biggest remaining failure?
5. What happens when next year's manual comes out? (It already happened mid-year: DECISIONS #34.)
6. Why pgvector over Pinecone?
7. Your corpus grew from 1 document to 3,800 and quality collapsed. How did you find out, and what fixed it?
8. How do you crawl a site responsibly? What did you do when an endpoint said "Unauthorized"?
9. You used real student emails. How did you handle privacy?
