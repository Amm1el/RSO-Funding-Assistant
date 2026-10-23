# Walkthrough: understand this project well enough to defend it

Work through this before listing the project anywhere. For each step, read the files, run the command, then answer the questions out loud without looking. Do the exercise yourself; that's the part an interviewer can tell you did.

## 0. Run it
- `npm run db:up`, `npm run ingest -- data/26-27SGAFM.pdf`, `npm run build && npm start`, then ask five questions in the UI.
- Open `/health`. Which embedder and generator are live, and why those?

## 1. Ingestion: `src/ingest/chunk.ts`
- `npx tsx scripts/dump-pages.ts` and compare with `SELECT section, page_start, left(content, 80) FROM chunks ORDER BY ordinal;`
- Why parse the table of contents instead of detecting headings by formatting? What does `matchHeading` tolerate, and why "one edit per 12 characters"?
- How does a child section get its parent's name? Which sections get it and which don't?
- What two bugs did the eval find in ingestion (DECISIONS #12)? Explain each in one sentence.
- **Exercise:** the "Last chance to spend funds" deadline (May 15) is buried in "Financial Certification: Requirements". Detect sub-headings that aren't in the TOC (short line, no ending punctuation, followed by body text) and label them, then show the effect with `npm run eval -- --record`.

## 2. Storage and search: `db/schema.sql`, `src/db.ts`, `src/pipeline.ts`
- What does `vector(1536)` mean? What does `<=>` compute, and why is similarity `1 - distance`?
- What does the `tsv` generated column contain, and why `replace(content, '/', ' ')`?
- Walk through `retrieve()`: vector search, the cutoff, keyword search, reciprocal rank fusion. Why RRF instead of adding the two scores?
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
- **Exercise (most valuable):** go through `evals/questions.jsonl` as the RSOAC chair. Fix anything wrong, set `"verified": true`, and add 10 real questions from your inbox. Then add your keys, re-ingest, and run `npm run eval -- --judge --record "OpenAI embeddings + Claude"`. Put the new row in the README.

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
5. What happens when next year's manual comes out?
6. Why pgvector over Pinecone?
7. What would you change to serve every SGA document, not just this manual?
