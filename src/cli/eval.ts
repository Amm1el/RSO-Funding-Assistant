import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { createPool } from "../db.js";
import { finalizeAnswer } from "../answer.js";
import { retrieve, type RetrievalMode } from "../pipeline.js";
import { createDeps, type GeneratorChoice } from "../runtime.js";
import { ClaudeJudge } from "../judge.js";
import { loadEvalCases, scoreCase, summarize, type CaseResult } from "../evals.js";

/*
Usage: npm run eval -- [options]
  --generator auto|claude|extractive   default auto: Claude if ANTHROPIC_API_KEY is set
  --mode hybrid|vector                 retrieval mode (default hybrid)
  --judge                              also grade answers with an LLM judge (needs ANTHROPIC_API_KEY)
  --min-pass N / --min-retrieval N     exit 1 if pass rate / retrieval hit rate is below N (for CI)
  --record "what changed"              append the summary to evals/history.jsonl to track progress
*/
const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const generatorChoice = (flag("--generator") ?? "auto") as GeneratorChoice;
const mode = (flag("--mode") ?? "hybrid") as RetrievalMode;
const minPass = Number(flag("--min-pass") ?? 0);
const minRetrieval = Number(flag("--min-retrieval") ?? 0);
const note = flag("--record");
/** Search one section only (e.g. funding); default: each case's own collection, else all sources. */
const collectionFlag = flag("--collection");
const judge = args.includes("--judge") ? new ClaudeJudge() : null;

const cases = await loadEvalCases("evals/questions.jsonl");
const pool = createPool();
const deps = await createDeps(pool, generatorChoice);
console.log(`Evaluating ${cases.length} cases: ${deps.embedder.name} retrieval (${mode}), ${deps.generator.name} answers\n`);

const results: (CaseResult & { answer: string; judgeReason?: string })[] = [];
for (const c of cases) {
  const collection = collectionFlag === "all" ? null : (collectionFlag ?? c.collection ?? null);
  const chunks = await retrieve(deps, c.question, undefined, mode, { collection });
  const answer = chunks.length
    ? finalizeAnswer(await deps.generator.generate(c.question, chunks), chunks)
    : { answerable: false, answer: "", citations: [] };
  const r: CaseResult & { answer: string; judgeReason?: string } = { ...scoreCase(c, chunks, answer), answer: answer.answer };
  if (judge && c.reference_answer) {
    const verdict = await judge.judge(c.question, c.reference_answer, answer.answerable ? answer.answer : "(refused: not covered by the manual)");
    r.judgeCorrect = verdict.correct;
    r.judgeReason = verdict.reason;
  }
  results.push(r);
  const notes = [
    r.retrievalHit === false ? "retrieval miss" : "",
    r.citationCorrect === false ? "wrong section cited" : "",
    !r.answerableCorrect ? (c.answerable ? "refused" : "should have refused") : "",
    r.factsFound < r.factsTotal ? `facts ${r.factsFound}/${r.factsTotal}` : "",
  ].filter(Boolean);
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${c.id.padEnd(28)} ${notes.join(", ")}`);
}
await pool.end();

const summary = summarize(results);
console.log("");
console.table(summary);

const config = { embedder: deps.embedder.name, mode, generator: deps.generator.name, judge: Boolean(judge), collection: collectionFlag ?? "per-case", sources: deps.corpus.documents };
const stamp = new Date().toISOString();
await mkdir("evals/results", { recursive: true });
const file = `evals/results/${stamp.slice(0, 19).replace(/:/g, "")}-${deps.generator.name.replace(/[:/]/g, "_")}.json`;
await writeFile(file, JSON.stringify({ config, summary, results }, null, 2));
console.log(`Details: ${file}`);

if (note) {
  let commit = "unknown";
  try {
    commit = execSync("git rev-parse --short HEAD").toString().trim();
  } catch {}
  await appendFile("evals/history.jsonl", JSON.stringify({ date: stamp.slice(0, 10), commit, note, ...config, ...summary }) + "\n");
  console.log("Recorded in evals/history.jsonl");
}

let failed = false;
if (summary.passRate < minPass) {
  console.error(`Pass rate ${summary.passRate}% is below the required ${minPass}%.`);
  failed = true;
}
if (summary.retrievalHitRate < minRetrieval) {
  console.error(`Retrieval hit rate ${summary.retrievalHitRate}% is below the required ${minRetrieval}%.`);
  failed = true;
}
if (failed) process.exit(1);
