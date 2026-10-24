import { createPool } from "../src/db.js";
import { createDeps } from "../src/runtime.js";
import { retrieve } from "../src/pipeline.js";
const pool = createPool();
const deps = await createDeps(pool, "extractive");
for (const q of process.argv.slice(2)) {
  console.log(`\n## ${q}`);
  for (const c of await retrieve(deps, q, 6, "hybrid", { collection: "funding" })) console.log(`  ${c.similarity.toFixed(2)} w${c.weight} ${(c.title ?? "").slice(0, 50).padEnd(50)} | ${c.section.slice(0, 45)}`);
}
await pool.end();
