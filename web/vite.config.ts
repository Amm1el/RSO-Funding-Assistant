import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Normal build: served by the Express API. `--mode static`: one self-contained HTML file
// (scripts, styles, fonts and the manual inlined) that runs the keyless pipeline with no server.
// The packed corpus is generated (npm run build:static does it first) and not committed.
// When it's missing, e.g. a plain `npm run build`, resolve it to an empty one.
const generated = fileURLToPath(new URL("./src/generated/corpus-data.ts", import.meta.url));
const corpusStub: Plugin = {
  name: "corpus-stub",
  resolveId(id) {
    return id.endsWith("generated/corpus-data") && !existsSync(generated) ? "\0corpus-stub" : null;
  },
  load(id) {
    return id === "\0corpus-stub" ? 'export const CORPUS_GZ_BASE64 = "";' : null;
  },
};

export default defineConfig(({ mode }) => ({
  plugins: mode === "static" ? [react(), viteSingleFile(), corpusStub] : [react(), corpusStub],
  build: mode === "static" ? { outDir: "dist-static" } : {},
  // In development the API runs on :3000 (npm run dev); Vite forwards /api to it.
  server: { proxy: { "/api": "http://localhost:3000", "/health": "http://localhost:3000" } },
}));
