// Turns "No, that was wrong" feedback into draft eval cases (verified: false) to review and
// append to evals/questions.jsonl. Prints JSONL; nothing is written for you.
// Usage: npx tsx scripts/feedback-to-evals.ts > evals/feedback-drafts.jsonl
import { createPool, listFeedback } from "../src/db.js";

const pool = createPool();
const rows = await listFeedback(pool, { helpful: false });
await pool.end();
for (const f of rows) {
  console.log(
    JSON.stringify({
      id: `feedback-${f.id}`,
      question: f.question,
      answerable: true,
      expected_section: "",
      must_include: [],
      reference_answer: f.note ? `TODO (user said: ${f.note})` : "TODO",
      collection: f.collection ?? undefined,
      origin: "feedback",
      verified: false,
    }),
  );
}
console.error(`${rows.length} wrong-answer reports. Fill in expected_section, must_include and reference_answer, then add them to evals/questions.jsonl.`);
