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
    documentId: 1,
    embedder: { name: "fake", minSimilarity: 0.25, embed: vi.fn().mockResolvedValue([[0.1, 0.2]]) },
    generator: { name: "fake", generate },
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
    expect(res.body.passages[0]).toMatchObject({ section: "LODGING", pageStart: 12 });
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

describe("POST /api/feedback", () => {
  const body = { question: "What is the hotel limit?", collection: "funding", answer: "Up to $225.", helpful: false, note: "Missed the tax rule", generator: "extractive", sections: ["LODGING"] };

  it("stores feedback without any client details", async () => {
    const { deps } = fakeDeps([]);
    const res = await request(createApp(deps)).post("/api/feedback").send(body);
    expect(res.status).toBe(204);
    const [sql, params] = (deps.pool.query as any).mock.calls[0];
    expect(sql).toMatch(/INSERT INTO feedback/);
    expect(params).toEqual(["What is the hotel limit?", "funding", "Up to $225.", false, "Missed the tax rule", "extractive", ["LODGING"]]);
  });

  it("rejects malformed feedback", async () => {
    const { deps } = fakeDeps([]);
    expect((await request(createApp(deps)).post("/api/feedback").send({ ...body, helpful: "nope" })).status).toBe(400);
    expect((await request(createApp(deps)).post("/api/feedback").send({ ...body, collection: "not-a-section" })).status).toBe(400);
  });

  it("limits how much one client can send", async () => {
    const { deps } = fakeDeps([]);
    const app = createApp(deps);
    const statuses = [];
    for (let i = 0; i < 22; i++) statuses.push((await request(app).post("/api/feedback").send(body)).status);
    expect(statuses.filter((s) => s === 204)).toHaveLength(20);
    expect(statuses.at(-1)).toBe(429);
  });
});
