import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { createPool } from "./db.js";
import { ask, retrieve, type Deps } from "./pipeline.js";
import { createDeps } from "./runtime.js";

/**
 * Exposes the assistant to MCP clients (Claude Desktop, Claude Code) over stdio,
 * so an assistant can look up funding rules while helping an officer plan an event.
 * Dependencies are created on the first tool call, so the server starts (and lists
 * its tools) even before the database is reachable.
 */
let deps: Promise<Deps> | undefined;
const getDeps = () => (deps ??= createDeps(createPool()));

export const server = new McpServer({ name: "rso-funding-assistant", version: "0.2.0" });

server.registerTool(
  "ask_funding_manual",
  {
    title: "Ask the FSU RSO Financial Manual",
    description:
      "Answers a question about FSU SGA funding rules for registered student organizations (RSOAC limits, prohibited purchases, travel, receipts, deadlines), citing manual sections and pages. Returns answerable=false when the manual doesn't cover the question.",
    inputSchema: { question: z.string().min(3).max(500) },
  },
  async ({ question }) => {
    const { passages: _passages, ...result } = await ask(await getDeps(), question);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

server.registerTool(
  "search_funding_manual",
  {
    title: "Search the FSU RSO Financial Manual",
    description: "Returns the manual passages most relevant to a query, with section and page numbers, without generating an answer.",
    inputSchema: { query: z.string().min(3).max(500), k: z.number().int().min(1).max(10).optional() },
  },
  async ({ query, k }) => {
    const chunks = await retrieve(await getDeps(), query, k ?? 5);
    const text = chunks
      .map((c) => `## ${c.section} (p. ${c.pageStart}${c.pageEnd !== c.pageStart ? `-${c.pageEnd}` : ""})\n${c.content}`)
      .join("\n\n");
    return { content: [{ type: "text", text: text || "No relevant passages found." }] };
  },
);

// pathToFileURL handles Windows paths (C:\...), which a hand-built "file://" string doesn't.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await server.connect(new StdioServerTransport());
}
