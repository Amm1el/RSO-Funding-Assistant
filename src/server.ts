import express from "express";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { config } from "./config.js";
import { createPool } from "./db.js";
import { ask, type Deps } from "./pipeline.js";
import { createDeps } from "./runtime.js";
import { COLLECTIONS, COLLECTION_IDS } from "./corpus/collections.js";
import { getMeta, type CorpusInfo } from "./db.js";
import type { Directory } from "./corpus/directory.js";

const AskBody = z.object({
  question: z.string().trim().min(3).max(500),
  collection: z.enum(COLLECTION_IDS as unknown as [string, ...string[]]).nullish(),
});

/** The built React app (npm run build). */
const WEB_DIST = fileURLToPath(new URL("../web/dist", import.meta.url));

export function createApp(deps: Deps & { corpus?: CorpusInfo }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "10kb" }));
  if (existsSync(WEB_DIST)) app.use(express.static(WEB_DIST));
  else app.get("/", (_req, res) => void res.type("text").send("The web UI isn't built yet. Run: npm run build (or npm run dev:web for live reload)."));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      sources: deps.corpus?.documents ?? 0,
      chunks: deps.corpus?.chunks ?? 0,
      updatedAt: deps.corpus?.updatedAt ?? null,
      embedder: deps.embedder.name,
      generator: deps.generator.name,
    });
  });

  /** The app's sections, with how much each one holds. */
  app.get("/api/collections", (_req, res) => {
    res.json(COLLECTIONS.map((c) => ({ ...c, chunks: deps.corpus?.collections[c.id] ?? 0 })));
  });

  /** Offices, positions and meeting places found across the sources. */
  app.get("/api/directory", async (_req, res) => {
    try {
      res.json((await getMeta<Directory>(deps.pool, "directory")) ?? { contacts: [], places: [], builtAt: null });
    } catch (err) {
      console.error(err);
      res.status(502).json({ error: "Could not load the directory." });
    }
  });

  app.post("/api/ask", async (req, res) => {
    const parsed = AskBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Send JSON like {"question": "...", "collection": "funding"} (question: 3-500 characters).' });
      return;
    }
    try {
      res.json(await ask(deps, parsed.data.question, { collection: parsed.data.collection }));
    } catch (err) {
      console.error(err);
      res.status(502).json({ error: "Could not answer right now. Please try again." });
    }
  });

  return app;
}

// pathToFileURL handles Windows paths (C:\...), which a hand-built "file://" string doesn't.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const deps = await createDeps(createPool());
  createApp(deps).listen(config.PORT, () => {
    console.log(`RSO Funding Assistant on http://localhost:${config.PORT}`);
    console.log(`  ${deps.corpus.documents} sources, ${deps.corpus.chunks} chunks, ${deps.embedder.name} retrieval, ${deps.generator.name} answers`);
    if (!config.USE_AI) console.log("  USE_AI is off: no API calls. Set USE_AI=true (and re-ingest for OpenAI embeddings) to turn AI on.");
    else if (deps.embedder.name.startsWith("hash:") && config.OPENAI_API_KEY)
      console.log("  USE_AI is on, but the manual was ingested offline. Run npm run ingest to switch to OpenAI embeddings.");
  });
}
