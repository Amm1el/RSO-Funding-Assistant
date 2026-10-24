import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_CORPUS_DIR } from "../corpus/load.js";

/*
Downloads the latest crawl (the corpus-data branch, written weekly by
.github/workflows/crawl.yml) into data/corpus. Plain git, so it works on Windows too.
Usage: npm run corpus:pull [-- --remote origin]
*/
const args = process.argv.slice(2);
const remote = args.includes("--remote") ? args[args.indexOf("--remote") + 1] : "origin";
const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 });

git("fetch", "--depth", "1", remote, "corpus-data:refs/remotes/" + remote + "/corpus-data");
const ref = `${remote}/corpus-data`;
await mkdir(DEFAULT_CORPUS_DIR, { recursive: true });
const files = git("ls-tree", "--name-only", ref).split("\n").filter(Boolean);
for (const f of files) await writeFile(join(DEFAULT_CORPUS_DIR, f), execFileSync("git", ["show", `${ref}:${f}`], { maxBuffer: 1024 * 1024 * 1024 }));
console.log(`Pulled ${files.length} files into ${DEFAULT_CORPUS_DIR}: ${git("log", "-1", "--format=%s", ref).trim()}`);

// A stale corpus means the weekly crawl has been failing; say so loudly (and as a
// GitHub annotation when running in Actions).
const manifest = JSON.parse(await readFile(join(DEFAULT_CORPUS_DIR, "manifest.json"), "utf8")) as { crawledAt: string };
const days = (Date.now() - new Date(manifest.crawledAt).getTime()) / 86400_000;
if (days > 10) {
  const msg = `The corpus is ${Math.floor(days)} days old: the weekly crawl may be failing (see Actions > Crawl SGA sources).`;
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : msg);
}
