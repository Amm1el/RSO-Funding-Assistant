# Walkthrough: understand this project well enough to defend it

Work through this before listing the project anywhere. For each step, read the file, then answer the questions out loud without looking.

## 1. Ingestion: `src/ingest/pdf.ts`, `src/ingest/chunk.ts`
- Run `npm run ingest -- data/26-27SGAFM.pdf --offline` and look at the rows: `SELECT section, page_start, left(content, 80) FROM chunks ORDER BY ordinal;`
- Why parse the table of contents instead of detecting headings by formatting?
- What does `normalizeHeading` remove, and why? What does `editDistance` compute? Why "one edit per 12 characters"?
- Why can't a chunk span two sections? What does the 50-word overlap protect against?
- **Exercise:** sections like "Requirements" lose their parent ("Financial Certification"). Make child sections carry the parent name, e.g. "Financial Certification: Requirements", and add a test.

## 2. Storage and search: `db/schema.sql`, `src/db.ts`
- What does `vector(1536)` mean, and where does 1536 come from?
- What does `<=>` compute? Why is similarity `1 - distance`?
- What is an HNSW index, and when would you not bother with one?
- Why is `saveDocument` wrapped in `BEGIN`/`COMMIT`? What does the rollback test prove?

## 3. Answering: `src/pipeline.ts`, `src/answer.ts`
- Walk through `ask()` from question to response.
- Why force a tool call instead of asking for JSON in the prompt?
- What exactly does `validateCitations` check? Give an example answer it would reject.
- Why skip the model when nothing passes `MIN_SIMILARITY`?
- **Exercise:** add hybrid search: combine pgvector similarity with Postgres full-text search (`to_tsvector`/`ts_rank`) so exact terms like "EIN" rank well. Measure with the eval before and after.

## 4. API, web page and MCP: `src/server.ts`, `public/index.html`, `src/mcp.ts`
- What does the zod schema on `/api/ask` reject?
- How would you connect the MCP server to Claude Desktop, and what does each tool return?

## 5. Tests and evals: `tests/`, `src/evals.ts`, `evals/questions.jsonl`
- Which tests need a database and which don't? How does CI provide one?
- What do retrieval hit rate, answerability accuracy and fact recall each tell you?
- **Exercise (most valuable):** replace the draft questions with 20+ real questions from the RSOAC inbox, check each answer against the manual, set `"verified": true`, run `npm run eval`, and put the scores in the README.

## Questions to expect in an interview
1. How do you stop the model from making things up?
2. How did you choose chunk size, and how would you know if it's wrong?
3. What happens when next year's manual comes out?
4. Why pgvector over Pinecone?
5. What does your eval measure, and what's your current score?
6. What would you change to serve every SGA document, not just this manual?
