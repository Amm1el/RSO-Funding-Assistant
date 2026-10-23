// Prints the best vector similarity for each eval question, split by answerable/unanswerable.
// Use it to choose an embedder's minSimilarity cutoff: it should sit between the two groups.
// Usage: npx tsx scripts/similarity-report.ts
import { createPool, searchChunks } from "../src/db.js";
import { createDeps } from "../src/runtime.js";
import { loadEvalCases } from "../src/evals.js";

const pool = createPool();
const deps = await createDeps(pool, "extractive");
for (const c of await loadEvalCases("evals/questions.jsonl")) {
  const [e] = await deps.embedder.embed([c.question]);
  const [top] = await searchChunks(pool, deps.documentId, e, 1);
  console.log(`${c.answerable ? "answerable  " : "UNANSWERABLE"} ${top.similarity.toFixed(3)}  ${c.id}`);
}
console.log(`\ncurrent cutoff for ${deps.embedder.name}: ${deps.embedder.minSimilarity}`);
await pool.end();
