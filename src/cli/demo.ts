/*
 * One command to a working app, no Docker and no API keys: npm run demo
 *   1. downloads the manual into data/ if it isn't there
 *   2. builds the web UI if it isn't built
 *   3. stores everything in embedded Postgres (PGlite) under data/pglite
 *   4. ingests the manual the first time, then starts the server and opens the browser
 * Flags: --no-open (don't open a browser), --use-database-url (use DATABASE_URL instead of PGlite)
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const args = process.argv.slice(2);
if (!args.includes("--use-database-url")) process.env.DATABASE_URL = "pglite://data/pglite";

const root = fileURLToPath(new URL("../../", import.meta.url));
const manual = join(root, "data", "26-27SGAFM.pdf");
const MANUAL_URL = "https://sga.fsu.edu/sites/default/files/PDFs/Accounting/26-27SGAFM.pdf";

// Imported after DATABASE_URL is set, because config reads the environment on import.
const { config } = await import("../config.js");
const { createPool, getActiveDocument, migrate } = await import("../db.js");
const { defaultEmbedder } = await import("../embeddings.js");
const { ingestManual } = await import("../ingest/run.js");
const { allowedProviders, createDeps } = await import("../runtime.js");
const { createApp } = await import("../server.js");

if (!existsSync(manual)) {
  console.log("Downloading the 2026-27 RSO Financial Manual...");
  const res = await fetch(MANUAL_URL);
  if (!res.ok) throw new Error(`Couldn't download the manual (${res.status}). Save it as data/26-27SGAFM.pdf from ${MANUAL_URL}`);
  await mkdir(join(root, "data"), { recursive: true });
  await writeFile(manual, Buffer.from(await res.arrayBuffer()));
}

if (!existsSync(join(root, "web", "dist", "index.html"))) {
  console.log("Building the web UI (first run only)...");
  const build = spawnSync("npm", ["run", "build"], { cwd: root, stdio: "inherit", shell: true });
  if (build.status !== 0) throw new Error("Web build failed; see the output above.");
}

const pool = createPool();
await migrate(pool);
if (!(await getActiveDocument(pool, allowedProviders().slice(0, 1)))) {
  console.log("Loading the manual into the database (first run only)...");
  await ingestManual(pool, manual, defaultEmbedder());
}

const deps = await createDeps(pool);
const url = `http://localhost:${config.PORT}`;
createApp(deps).listen(config.PORT, () => {
  console.log(`\nRSO Funding Assistant is running at ${url}`);
  console.log(`  ${deps.embedder.name} retrieval, ${deps.generator.name} answers${config.USE_AI ? "" : " (USE_AI is off: no API calls)"}`);
  console.log("  Press Ctrl+C to stop.\n");
  if (!args.includes("--no-open")) openBrowser(url);
});

function openBrowser(target: string) {
  const [cmd, cmdArgs] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", target]] : process.platform === "darwin" ? ["open", [target]] : ["xdg-open", [target]];
  spawn(cmd, cmdArgs as string[], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}
