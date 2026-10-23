import { createPool, getActiveDocument } from "../db.js";
import { allowedProviders } from "../runtime.js";

// Prints "yes" if the manual has been ingested with the preferred embedder for the current
// mode (offline when USE_AI is off, OpenAI when it's on), otherwise "no". Used by scripts/start.sh.
const pool = createPool();
const doc = await getActiveDocument(pool, allowedProviders().slice(0, 1));
console.log(doc ? "yes" : "no");
await pool.end();
