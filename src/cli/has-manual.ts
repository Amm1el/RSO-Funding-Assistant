import { createPool, getActiveDocument } from "../db.js";

// Prints "yes" if a manual has been ingested, otherwise "no". Used by scripts/start.sh.
const pool = createPool();
const doc = await getActiveDocument(pool);
console.log(doc && doc.chunks > 0 ? "yes" : "no");
await pool.end();
