import { createPool } from "../db.js";
import { getActiveCorpus } from "../db.js";
import { allowedProviders } from "../runtime.js";

// Prints "yes" if something has been ingested with the preferred embedder for the current
// mode (offline when USE_AI is off, OpenAI when it's on), otherwise "no". Used by scripts/start.sh.
const pool = createPool();
console.log((await getActiveCorpus(pool, allowedProviders().slice(0, 1))) ? "yes" : "no");
await pool.end();
