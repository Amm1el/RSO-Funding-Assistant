import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
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
