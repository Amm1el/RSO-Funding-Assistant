import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { createPool } from "./db.js";
import { ask, retrieve, type Deps } from "./pipeline.js";
import { createDeps } from "./runtime.js";
import { COLLECTIONS, COLLECTION_IDS } from "./corpus/collections.js";

/**
 * Exposes the assistant to MCP clients (Claude Desktop, Claude Code) over stdio,
 * so an assistant can look up funding rules while helping an officer plan an event.
 * Dependencies are created on the first tool call, so the server starts (and lists
 * its tools) even before the database is reachable.
 */
let deps: Promise<Deps> | undefined;
const getDeps = () => (deps ??= createDeps(createPool()));

export const server = new McpServer({ name: "rso-funding-assistant", version: "0.3.0" });

const SECTION = z
  .enum(COLLECTION_IDS as unknown as [string, ...string[]])
  .optional()
  .describe(`Limit to one section: ${COLLECTIONS.map((c) => `${c.id} (${c.label})`).join(", ")}`);

server.registerTool(
  "ask_sga",
  {
    title: "Ask FSU Student Government",
    description:
      "Answers a question from FSU Student Government Association's published sources: the RSO Financial Manual, the Constitution and Statutes (incl. the Finance and Election Codes), COGS code, sga.fsu.edu and agency pages, linked documents, and Senate/COGS/funding-board meetings. Cites each source with a link. Returns answerable=false when the sources don't cover the question.",
    inputSchema: { question: z.string().min(3).max(500), section: SECTION },
  },
  async ({ question, section }) => {
    const { passages: _passages, ...result } = await ask(await getDeps(), question, { collection: section });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

server.registerTool(
  "search_sga",
  {
    title: "Search FSU Student Government sources",
    description: "Returns the passages most relevant to a query from SGA's published sources, each with its source title, section and link, without generating an answer.",
    inputSchema: { query: z.string().min(3).max(500), k: z.number().int().min(1).max(10).optional(), section: SECTION },
  },
  async ({ query, k, section }) => {
    const chunks = await retrieve(await getDeps(), query, k ?? 5, "hybrid", { collection: section });
    const text = chunks
      .map((c) => `## ${c.title ? `${c.title} › ` : ""}${c.section}${c.pageStart ? ` (p. ${c.pageStart}${c.pageEnd !== c.pageStart ? `-${c.pageEnd}` : ""})` : ""}\n${c.url ?? ""}\n${c.content}`)
      .join("\n\n");
    return { content: [{ type: "text", text: text || "No relevant passages found." }] };
  },
);

// pathToFileURL handles Windows paths (C:\...), which a hand-built "file://" string doesn't.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await server.connect(new StdioServerTransport());
}
