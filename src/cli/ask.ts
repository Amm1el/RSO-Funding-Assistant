import { createPool } from "../db.js";
import { ask } from "../pipeline.js";
import { createDeps } from "../runtime.js";

// Usage: npm run ask -- "How much can our RSO get from RSOAC this year?"
const question = process.argv.slice(2).join(" ").trim();
if (!question) {
  console.error('Usage: npm run ask -- "your question"');
  process.exit(1);
}
const pool = createPool();
const deps = await createDeps(pool);
const result = await ask(deps, question);
console.log(`\n${result.answer}\n`);
for (const c of result.citations) console.log(`  - ${c.section}, p. ${c.pages}: "${c.quote}"`);
if (!result.answerable) console.log("  (not answered from the manual)");
console.log(`\n  [${deps.embedder.name} retrieval, ${result.generator} answer]`);
await pool.end();
