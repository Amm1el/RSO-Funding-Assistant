// Scores the in-browser engine (web/src/engine.ts) on the eval set, so the phone build's
// quality is measured, not assumed. Usage: npx tsx scripts/eval-static.ts
import { askLocally } from "../web/src/engine.js";
import { loadEvalCases, scoreCase, summarize } from "../src/evals.js";

const results = [];
for (const c of await loadEvalCases("evals/questions.jsonl")) {
  const r = await askLocally(c.question);
  results.push(scoreCase(c, r.passages, r));
}
console.table(summarize(results));
