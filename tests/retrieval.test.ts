import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "../src/pipeline.js";
import { extractAnswer, sentences, terms } from "../src/extractive.js";
import { finalizeAnswer } from "../src/answer.js";
import { HashEmbedder, embedderByName } from "../src/embeddings.js";
import type { RetrievedChunk } from "../src/types.js";

describe("reciprocalRankFusion", () => {
  it("ranks an item found by both searches above items found by one", () => {
    const fused = reciprocalRankFusion([
      [{ id: 1 }, { id: 2 }],
      [{ id: 3 }, { id: 2 }],
    ]);
    expect(fused[0].item.id).toBe(2);
    expect(fused.map((f) => f.item.id).sort()).toEqual([1, 2, 3]);
  });

  it("keeps a single list's order", () => {
    expect(reciprocalRankFusion([[{ id: 9 }, { id: 4 }]]).map((f) => f.item.id)).toEqual([9, 4]);
  });
});

describe("extractive generator", () => {
  const chunks: RetrievedChunk[] = [
    {
      id: 1, ordinal: 0, section: "LODGING", pageStart: 12, pageEnd: 12, similarity: 0.5,
      content: "Daily hotel rate should not exceed $225 per night (before tax). Each room is expected to host four travelers. Hotel invoices should include the following:",
    },
  ];

  it("splits sentences and bullets", () => {
    expect(sentences("One two three four. Five six seven eight. ‣ Bullet item with words")).toEqual([
      "One two three four.", "Five six seven eight.", "Bullet item with words",
    ]);
  });

  it("drops stop words and plurals", () => {
    expect(terms("What are the receipts")).toEqual(["receipt"]);
  });

  it("quotes the best matching sentence, and the quote survives citation checks", () => {
    const raw = extractAnswer("What is the maximum hotel rate per night?", chunks);
    expect(raw.answer).toContain("$225");
    const final = finalizeAnswer(raw, chunks);
    expect(final.answerable).toBe(true);
    expect(final.citations[0]).toMatchObject({ section: "LODGING", pages: "12" });
  });

  it("refuses when nothing overlaps the question", () => {
    expect(extractAnswer("Who is the football coach?", chunks).answerable).toBe(false);
  });
});

describe("embedders", () => {
  it("hash embedder ignores stop words and is deterministic", async () => {
    const e = new HashEmbedder();
    const [a] = await e.embed(["the hotel rate"]);
    const [b] = await e.embed(["hotel rate"]);
    expect(a).toEqual(b);
  });

  it("recreates the embedder a document was ingested with", () => {
    expect(embedderByName("hash:bow-1536").name).toBe("hash:bow-1536");
    expect(() => embedderByName("mystery:model")).toThrow();
  });
});
