import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { server } from "../src/mcp.js";

// Connects a real MCP client to the server in memory. Listing tools needs no database,
// because the server creates its dependencies on the first tool call.
describe("MCP server", () => {
  it("advertises the ask and search tools with input schemas", async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientSide);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["ask_sga", "search_sga"]);
    expect(tools.find((t) => t.name === "ask_sga")?.inputSchema.required).toEqual(["question"]);
    await client.close();
  });
});
