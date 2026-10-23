import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Normal build: served by the Express API. `--mode static`: one self-contained HTML file
// (scripts, styles, fonts and the manual inlined) that runs the keyless pipeline with no server.
export default defineConfig(({ mode }) => ({
  plugins: mode === "static" ? [react(), viteSingleFile()] : [react()],
  build: mode === "static" ? { outDir: "dist-static" } : {},
  // In development the API runs on :3000 (npm run dev); Vite forwards /api to it.
  server: { proxy: { "/api": "http://localhost:3000", "/health": "http://localhost:3000" } },
}));
