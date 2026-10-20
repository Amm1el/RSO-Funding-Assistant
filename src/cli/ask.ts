import { createPool } from "../db.js";
import { OpenAIEmbedder } from "../embeddings.js";
import { ClaudeAnswerGenerator } from "../answer.js";
import { ask } from "../pipeline.js";

// Usage: npm run ask -- "How much can our RSO get from RSOAC this year?"
const question = process.argv.slice(2).join(" ").trim();
if (!question) {
  console.error('Usage: npm run ask -- "your question"');
  process.exit(1);
}
const pool = createPool();
const result = await ask({ pool, embedder: new OpenAIEmbedder(), generator: new ClaudeAnswerGenerator() }, question);
console.log(`\n${result.answer}\n`);
for (const c of result.citations) console.log(`  - ${c.section}, p. ${c.pages}: "${c.quote}"`);
if (!result.answerable) console.log("  (not answered from the manual)");
await pool.end();
