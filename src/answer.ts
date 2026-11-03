import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config, requireKey } from "./config.js";
import type { RetrievedChunk } from "./types.js";

export const SYSTEM_PROMPT = `You answer questions about Florida State University's Student Government Association (SGA): RSO funding, the Constitution and Statutes, elections, agencies, the Congress of Graduate Students, meetings, and student resources.

Rules:
- Use ONLY the numbered excerpts provided. Never use outside knowledge about FSU or other schools.
- First pick your evidence: for each citation, give the excerpt number and copy a phrase of 5 to 30 words from that excerpt exactly as written.
- "answerable" is about the SOURCES, not about yes or no: true when the excerpts state the answer, false when they don't. A question whose answer is "No, that's prohibited" IS answerable (true).
- Only answer what a cited phrase directly states. Never infer a "yes" from the excerpts being silent; if they don't say, set answerable to false and say what the sources don't cover.
- Write 1 to 3 complete sentences: the direct answer AND the rule, amount, deadline or office behind it, e.g. "No. Food for meetings with under 10 attendees is a prohibited purchase." Never reply with only "Yes" or "No". Put any list in the sentence instead of ending with a colon.
- When excerpts disagree, prefer the governing document (Constitution over Statutes over manuals and web pages; newer over older) and mention the other figure, e.g. "The Statutes cap hotels at $300 per room; the Financial Manual sets $225 per night."`;

/** Formats retrieved chunks as numbered excerpts the model can cite, each with its source. */
export function buildContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c, i) => {
      const pages = !c.pageStart ? "" : c.pageStart === c.pageEnd ? ` (p. ${c.pageStart})` : ` (pp. ${c.pageStart}-${c.pageEnd})`;
      const source = c.title ? `Source: ${c.title}\n` : "";
      return `[${i + 1}] ${source}Section: ${c.section}${pages}\n${c.content}`;
    })
    .join("\n\n");
}

/** The user turn sent to any model: excerpts, then the question. */
export function buildUserMessage(question: string, chunks: RetrievedChunk[]): string {
  return `Excerpts:\n\n${buildContext(chunks)}\n\nQuestion: ${question}`;
}

/** The structured output we force the model to produce, via a tool schema. */
export const AnswerToolInput = z.object({
  answerable: z.boolean(),
  answer: z.string(),
  citations: z.array(z.object({ excerpt: z.number().int(), quote: z.string() })),
});
export type AnswerToolInput = z.infer<typeof AnswerToolInput>;

export const ANSWER_TOOL: Anthropic.Tool = {
  name: "submit_answer",
  description: "Submit the final answer with citations to the numbered manual excerpts.",
  input_schema: {
    type: "object",
    properties: {
      citations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            excerpt: { type: "integer", description: "Excerpt number, e.g. 2 for [2]." },
            quote: { type: "string", description: "A 5-30 word phrase copied exactly from that excerpt." },
          },
          required: ["excerpt", "quote"],
        },
      },
      answer: { type: "string", description: "1-3 complete sentences: the direct answer and the rule, amount, deadline or office behind it." },
      answerable: { type: "boolean", description: "Whether the excerpts state the answer. A 'No, that's prohibited' answer is answerable (true)." },
    },
    required: ["citations", "answer", "answerable"],
  },
};

export interface AnswerGenerator {
  /** Shown in API responses and eval results, e.g. "claude:claude-sonnet-5-5" or "extractive". */
  readonly name: string;
  generate(question: string, chunks: RetrievedChunk[]): Promise<AnswerToolInput>;
}

export class ClaudeAnswerGenerator implements AnswerGenerator {
  readonly name = `claude:${config.ANSWER_MODEL}`;
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
          content: buildUserMessage(question, chunks),
        },
      ],
    });
    const block = res.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") throw new Error("Model did not return a structured answer");
    return AnswerToolInput.parse(block.input);
  }
}

export { finalizeAnswer, validateCitations } from "./citations.js";
