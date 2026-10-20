import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config, requireKey } from "./config.js";
import type { Answer, Citation, RetrievedChunk } from "./types.js";

export const SYSTEM_PROMPT = `You answer questions from Florida State University registered student organizations (RSOs) about Student Government Association (SGA) funding.

Rules:
- Use ONLY the numbered manual excerpts provided. Never use outside knowledge about FSU or other schools.
- If the excerpts do not contain the answer, set answerable to false and say what the manual does not cover. Suggest contacting SGA-RSOAC@fsu.edu only if the excerpts mention it.
- Every factual claim must be supported by at least one cited excerpt. Cite by excerpt number.
- For each citation, include a short quote copied word for word from that excerpt.
- Be concise and practical: lead with the direct answer (yes/no, the limit, the deadline), then the conditions.`;

/** Formats retrieved chunks as numbered excerpts the model can cite. */
export function buildContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c, i) => {
      const pages = c.pageStart === c.pageEnd ? `p. ${c.pageStart}` : `pp. ${c.pageStart}-${c.pageEnd}`;
      return `[${i + 1}] Section: ${c.section} (${pages})\n${c.content}`;
    })
    .join("\n\n");
}

/** The structured output we force the model to produce, via a tool schema. */
const AnswerToolInput = z.object({
  answerable: z.boolean(),
  answer: z.string(),
  citations: z.array(z.object({ excerpt: z.number().int(), quote: z.string() })),
});
type AnswerToolInput = z.infer<typeof AnswerToolInput>;

export const ANSWER_TOOL: Anthropic.Tool = {
  name: "submit_answer",
  description: "Submit the final answer with citations to the numbered manual excerpts.",
  input_schema: {
    type: "object",
    properties: {
      answerable: { type: "boolean", description: "False if the excerpts do not answer the question." },
      answer: { type: "string", description: "The answer for the student organization." },
      citations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            excerpt: { type: "integer", description: "Excerpt number, e.g. 2 for [2]." },
            quote: { type: "string", description: "Short exact quote from that excerpt." },
          },
          required: ["excerpt", "quote"],
        },
      },
    },
    required: ["answerable", "answer", "citations"],
  },
};

/**
 * Keeps only citations that point at a real excerpt and whose quote actually appears in it.
 * This is the guard against the model inventing sources.
 */
export function validateCitations(raw: AnswerToolInput["citations"], chunks: RetrievedChunk[]): Citation[] {
  const squash = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of raw) {
    const chunk = chunks[c.excerpt - 1];
    if (!chunk) continue;
    if (!squash(chunk.content).includes(squash(c.quote))) continue;
    const key = `${chunk.id}:${c.quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      chunkId: chunk.id,
      section: chunk.section,
      pages: chunk.pageStart === chunk.pageEnd ? `${chunk.pageStart}` : `${chunk.pageStart}-${chunk.pageEnd}`,
      quote: c.quote,
    });
  }
  return out;
}

export interface AnswerGenerator {
  generate(question: string, chunks: RetrievedChunk[]): Promise<AnswerToolInput>;
}

export class ClaudeAnswerGenerator implements AnswerGenerator {
  private client = new Anthropic({ apiKey: requireKey("ANTHROPIC_API_KEY") });

  async generate(question: string, chunks: RetrievedChunk[]): Promise<AnswerToolInput> {
    const res = await this.client.messages.create({
      model: config.ANSWER_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [ANSWER_TOOL],
      tool_choice: { type: "tool", name: ANSWER_TOOL.name },
      messages: [
        {
          role: "user",
          content: `Manual excerpts:\n\n${buildContext(chunks)}\n\nQuestion: ${question}`,
        },
      ],
    });
    const block = res.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") throw new Error("Model did not return a structured answer");
    return AnswerToolInput.parse(block.input);
  }
}

/**
 * Turns the model's output into the API response. An answer that claims to be
 * answerable but has no surviving citation is downgraded to unanswerable.
 */
export function finalizeAnswer(raw: AnswerToolInput, chunks: RetrievedChunk[]): Answer {
  const citations = validateCitations(raw.citations, chunks);
  if (raw.answerable && citations.length === 0) {
    return {
      answerable: false,
      answer: "I couldn't find support for an answer in the Financial Manual. Please check with SGA directly.",
      citations: [],
    };
  }
  return { answerable: raw.answerable, answer: raw.answer, citations };
}
