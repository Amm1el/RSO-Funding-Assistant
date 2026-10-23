import { describe, expect, it } from "vitest";
import { highlight } from "../web/src/highlight.js";

describe("highlight (web UI)", () => {
  it("marks a quote regardless of case and line-wrap whitespace", () => {
    const segs = highlight("Daily hotel rate should not exceed $225 per night (before tax).", ["NOT exceed  $225 per night"]);
    expect(segs).toEqual([
      { text: "Daily hotel rate should ", marked: false },
      { text: "not exceed $225 per night", marked: true },
      { text: " (before tax).", marked: false },
    ]);
  });

  it("merges overlapping quotes and ignores ones that aren't present", () => {
    const segs = highlight("one two three four five", ["two three", "three four", "missing words"]);
    expect(segs.filter((s) => s.marked).map((s) => s.text)).toEqual(["two three four"]);
  });
});
