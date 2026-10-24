// Starts the MCP server the way Claude Desktop does (a child process over stdio) and calls both tools.
// Usage: npx tsx scripts/mcp-smoke.ts "your question"
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const question = process.argv.slice(2).join(" ") || "What is the maximum hotel rate per night?";
const transport = new StdioClientTransport({ command: "npx", args: ["tsx", fileURLToPath(new URL("../src/mcp.ts", import.meta.url))], env: { ...process.env } as Record<string, string>, stderr: "ignore" });
const client = new Client({ name: "smoke-test", version: "1.0.0" });
await client.connect(transport);
console.log("tools:", (await client.listTools()).tools.map((t) => t.name).join(", "));
for (const [name, args] of [["ask_sga", { question }], ["search_sga", { query: question, k: 2 }]] as const) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as { type: string; text: string }[])[0].text;
  console.log(`\n--- ${name}\n${text.slice(0, 700)}`);
}
await client.close();
