import express from "express";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { config } from "./config.js";
import { createPool } from "./db.js";
import { ask, type Deps } from "./pipeline.js";
import { createDeps } from "./runtime.js";

const AskBody = z.object({ question: z.string().trim().min(3).max(500) });

/** The built React app (npm run build). */
const WEB_DIST = fileURLToPath(new URL("../web/dist", import.meta.url));

export function createApp(deps: Deps & { document?: { version: string } }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "10kb" }));
  if (existsSync(WEB_DIST)) app.use(express.static(WEB_DIST));
  else app.get("/", (_req, res) => void res.type("text").send("The web UI isn't built yet. Run: npm run build (or npm run dev:web for live reload)."));

  app.get("/health", async (_req, res) => {
    const { rows } = await deps.pool.query("SELECT count(*)::int AS chunks FROM chunks WHERE document_id = $1", [deps.documentId]);
    res.json({
      ok: true,
      manual: deps.document?.version,
      chunks: rows[0].chunks,
      embedder: deps.embedder.name,
      generator: deps.generator.name,
    });
  });

  app.post("/api/ask", async (req, res) => {
    const parsed = AskBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Send JSON like {"question": "..."} (3-500 characters).' });
      return;
    }
    try {
      res.json(await ask(deps, parsed.data.question));
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
    console.log(`  manual ${deps.document.version}, ${deps.embedder.name} retrieval, ${deps.generator.name} answers`);
    if (!config.USE_AI) console.log("  USE_AI is off: no API calls. Set USE_AI=true (and re-ingest for OpenAI embeddings) to turn AI on.");
    else if (deps.embedder.name.startsWith("hash:") && config.OPENAI_API_KEY)
      console.log("  USE_AI is on, but the manual was ingested offline. Run npm run ingest to switch to OpenAI embeddings.");
  });
}
