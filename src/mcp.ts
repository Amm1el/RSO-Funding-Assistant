import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createPool } from "./db.js";
import { OpenAIEmbedder } from "./embeddings.js";
import { ClaudeAnswerGenerator } from "./answer.js";
import { ask, retrieve } from "./pipeline.js";

/**
 * Exposes the assistant to MCP clients (Claude Desktop, Claude Code) over stdio,
 * so an assistant can look up funding rules while helping an officer plan an event.
 */
const deps = { pool: createPool(), embedder: new OpenAIEmbedder(), generator: new ClaudeAnswerGenerator() };
const server = new McpServer({ name: "rso-funding-assistant", version: "0.1.0" });

server.registerTool(
  "ask_funding_manual",
  {
    title: "Ask the FSU RSO Financial Manual",
    description: "Answers a question about FSU SGA funding rules for student organizations, with cited sections and pages.",
    inputSchema: { question: z.string().min(3).max(500) },
  },
  async ({ question }) => {
    const result = await ask(deps, question);
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
    const chunks = await retrieve(deps, query, k ?? 5);
    const text = chunks
      .map((c) => `## ${c.section} (p. ${c.pageStart}${c.pageEnd !== c.pageStart ? `-${c.pageEnd}` : ""}), similarity ${c.similarity.toFixed(2)}\n${c.content}`)
      .join("\n\n");
    return { content: [{ type: "text", text: text || "No relevant passages found." }] };
  },
);

await server.connect(new StdioServerTransport());
