import express from "express";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { config } from "./config.js";
import { createPool } from "./db.js";
import { OpenAIEmbedder } from "./embeddings.js";
import { ClaudeAnswerGenerator } from "./answer.js";
import { ask, type Deps } from "./pipeline.js";

const AskBody = z.object({ question: z.string().trim().min(3).max(500) });

export function createApp(deps: Deps) {
  const app = express();
  app.use(express.json({ limit: "10kb" }));
  app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));

  app.get("/health", async (_req, res) => {
    const { rows } = await deps.pool.query("SELECT count(*)::int AS chunks FROM chunks");
    res.json({ ok: true, chunks: rows[0].chunks });
  });

  app.post("/api/ask", async (req, res) => {
    const parsed = AskBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Send JSON like {\"question\": \"...\"} (3-500 characters)." });
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
  const app = createApp({ pool: createPool(), embedder: new OpenAIEmbedder(), generator: new ClaudeAnswerGenerator() });
  app.listen(config.PORT, () => console.log(`RSO Funding Assistant on http://localhost:${config.PORT}`));
}
