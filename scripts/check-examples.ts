// Runs every example question shown in the UI (web/src/sections.ts) through the pipeline in
// its section, so the ones in a demo are ones the sources actually answer.
// Usage: npx tsx scripts/check-examples.ts
import { createPool } from "../src/db.js";
import { createDeps } from "../src/runtime.js";
import { ask } from "../src/pipeline.js";
import { EXAMPLES } from "../web/src/sections.js";

const pool = createPool();
const deps = await createDeps(pool);
for (const [section, questions] of Object.entries(EXAMPLES)) {
  console.log(`\n## ${section}`);
  for (const q of questions) {
    const r = await ask(deps, q, { collection: section === "all" ? null : section });
    const c = r.citations[0];
    console.log(`${r.answerable ? "ANS " : "NONE"} ${q}\n     -> ${r.answer.slice(0, 160).replace(/\s+/g, " ")}\n     [${c ? `${c.title?.slice(0, 50)} › ${c.section.slice(0, 50)}` : "-"}]`);
  }
}
await pool.end();
