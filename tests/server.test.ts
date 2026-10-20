import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import type { Deps } from "../src/pipeline.js";

function fakeDeps(rows: object[]) {
  const generate = vi.fn().mockResolvedValue({
    answerable: true,
    answer: "Up to $225 per night.",
    citations: [{ excerpt: 1, quote: "$225 per night" }],
  });
  const deps = {
    pool: { query: vi.fn().mockResolvedValue({ rows }) },
    embedder: { embed: vi.fn().mockResolvedValue([[0.1, 0.2]]) },
    generator: { generate },
  } as unknown as Deps;
  return { deps, generate };
}

const lodgingRow = { id: 5, ordinal: 0, section: "LODGING", page_start: 12, page_end: 12, content: "Daily hotel rate should not exceed $225 per night.", similarity: 0.82 };

describe("POST /api/ask", () => {
  it("rejects a missing or too-short question", async () => {
    const { deps } = fakeDeps([]);
    const res = await request(createApp(deps)).post("/api/ask").send({ question: "hi" });
    expect(res.status).toBe(400);
  });

  it("returns a cited answer", async () => {
    const { deps } = fakeDeps([lodgingRow]);
    const res = await request(createApp(deps)).post("/api/ask").send({ question: "What is the hotel limit?" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ answerable: true, citations: [{ section: "LODGING", pages: "12", quote: "$225 per night" }] });
  });

  it("skips the model when nothing relevant is retrieved", async () => {
    const { deps, generate } = fakeDeps([{ ...lodgingRow, similarity: 0.05 }]);
    const res = await request(createApp(deps)).post("/api/ask").send({ question: "Who won the football game?" });
    expect(res.body.answerable).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });

  it("returns 502 when a dependency fails", async () => {
    const { deps } = fakeDeps([lodgingRow]);
    (deps.embedder.embed as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request(createApp(deps)).post("/api/ask").send({ question: "What is the hotel limit?" });
    expect(res.status).toBe(502);
  });
});
