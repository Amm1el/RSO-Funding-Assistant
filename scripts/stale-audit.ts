// Which questions get an outdated source (old budget, past minutes, an earlier edition)
// ranked above the current rule? Lists, per eval question, top passages whose source weight
// is below 0.6, i.e. history rather than current rules.
// Usage: npx tsx scripts/stale-audit.ts [--collection all]
import { createPool } from "../src/db.js";
import { createDeps } from "../src/runtime.js";
import { retrieve } from "../src/pipeline.js";
import { loadEvalCases } from "../src/evals.js";

const args = process.argv.slice(2);
const col = args.includes("--collection") ? args[args.indexOf("--collection") + 1] : undefined;
const pool = createPool();
const deps = await createDeps(pool, "extractive");
let flagged = 0;
for (const c of (await loadEvalCases("evals/questions.jsonl")).filter((c) => c.answerable)) {
  const chunks = await retrieve(deps, c.question, 3, "hybrid", { collection: col === "all" ? null : (col ?? c.collection ?? null) });
  const stale = chunks.map((ch, i) => ({ ch, rank: i + 1 })).filter(({ ch }) => (ch.weight ?? 1) < 0.6);
  if (!stale.length) continue;
  flagged++;
  console.log(`\n${c.id}: ${c.question}`);
  for (const { ch, rank } of stale) console.log(`  #${rank} w=${ch.weight} ${ch.title?.slice(0, 70)} › ${ch.section.slice(0, 50)}`);
}
console.log(`\n${flagged} questions with an outdated source in their top 3.`);
await pool.end();
