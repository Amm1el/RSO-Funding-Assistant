import { mkdir, writeFile } from "node:fs/promises";
import { createPool } from "../db.js";
import { OpenAIEmbedder } from "../embeddings.js";
import { ClaudeAnswerGenerator, finalizeAnswer } from "../answer.js";
import { retrieve } from "../pipeline.js";
import { loadEvalCases, scoreCase, summarize, type CaseResult } from "../evals.js";

// Usage: npm run eval [-- --min-pass 80]
const args = process.argv.slice(2);
const minPass = args.includes("--min-pass") ? Number(args[args.indexOf("--min-pass") + 1]) : 0;

const cases = await loadEvalCases("evals/questions.jsonl");
const pool = createPool();
const deps = { pool, embedder: new OpenAIEmbedder(), generator: new ClaudeAnswerGenerator() };

const results: CaseResult[] = [];
for (const c of cases) {
  const chunks = await retrieve(deps, c.question);
  const answer = chunks.length
    ? finalizeAnswer(await deps.generator.generate(c.question, chunks), chunks)
    : { answerable: false, answer: "", citations: [] };
  const r = scoreCase(c, chunks, answer);
  results.push(r);
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${c.id}  facts ${r.factsFound}/${r.factsTotal}  citations ${r.citations}${r.retrievalHit === false ? "  (retrieval miss)" : ""}`);
}
await pool.end();

const summary = summarize(results);
console.log("\n", summary);
await mkdir("evals/results", { recursive: true });
await writeFile(`evals/results/${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ summary, results }, null, 2));
if (summary.passRate < minPass) {
  console.error(`Pass rate ${summary.passRate}% is below the required ${minPass}%.`);
  process.exit(1);
}
