import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config, requireKey } from "./config.js";

/**
 * LLM-as-judge: compares the assistant's answer with the reference answer. String
 * matching (must_include) catches missing numbers; the judge catches answers that
 * contain the right number but say the wrong thing about it ("no more than $250" vs
 * "at least $250").
 */
export interface Judge {
  judge(question: string, reference: string, answer: string): Promise<{ correct: boolean; reason: string }>;
}

const Verdict = z.object({ correct: z.boolean(), reason: z.string() });

export class ClaudeJudge implements Judge {
  private client = new Anthropic({ apiKey: requireKey("ANTHROPIC_API_KEY") });

  async judge(question: string, reference: string, answer: string) {
    const res = await this.client.messages.create({
      model: config.JUDGE_MODEL,
      max_tokens: 300,
      system:
        "You grade answers about a student organization funding manual. An answer is correct if it agrees with the reference answer on every fact the question asks about (amounts, limits, deadlines, yes/no). Extra correct detail is fine. Missing or contradicting a key fact is incorrect. A refusal is correct only if the reference says the manual doesn't cover it.",
      tools: [
        {
          name: "submit_verdict",
          description: "Submit the grade.",
          input_schema: {
            type: "object",
            properties: { correct: { type: "boolean" }, reason: { type: "string", description: "One sentence." } },
            required: ["correct", "reason"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "submit_verdict" },
      messages: [{ role: "user", content: `Question: ${question}\n\nReference answer: ${reference}\n\nAnswer to grade: ${answer}` }],
    });
    const block = res.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") throw new Error("Judge did not return a verdict");
    return Verdict.parse(block.input);
  }
}
