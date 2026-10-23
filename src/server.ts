import express from "express";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { config } from "./config.js";
import { createPool } from "./db.js";
import { ask, type Deps } from "./pipeline.js";
import { createDeps } from "./runtime.js";

const AskBody = z.object({ question: z.string().trim().min(3).max(500) });

/** Static files: the built React app if present, otherwise the plain fallback page. */
const WEB_DIST = fileURLToPath(new URL("../web/dist", import.meta.url));
const FALLBACK = fileURLToPath(new URL("../public", import.meta.url));

export function createApp(deps: Deps & { document?: { version: string } }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "10kb" }));
  app.use(express.static(existsSync(WEB_DIST) ? WEB_DIST : FALLBACK));

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

if (import.meta.url === `file://${process.argv[1]}`) {
  const deps = await createDeps(createPool());
  createApp(deps).listen(config.PORT, () => {
    console.log(`RSO Funding Assistant on http://localhost:${config.PORT}`);
    console.log(`  manual ${deps.document.version}, ${deps.embedder.name} retrieval, ${deps.generator.name} answers`);
  });
}
