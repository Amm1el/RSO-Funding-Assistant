/**
 * Example questions per section. Each was checked against the crawled sources (see
 * scripts/check-examples.ts), so the ones shown in a demo are ones the sources answer.
 */
export const EXAMPLES: Record<string, string[]> = {
  all: [
    "What's the most RSOAC will fund per organization this year?",
    "Who can call a special session of the Senate?",
    "When does the Student Senate meet?",
    "Do we need three quotes for a big purchase?",
  ],
  funding: [
    "What's the most RSOAC will fund per organization this year?",
    "What is the maximum hotel rate per night?",
    "Do we need three quotes for a big purchase?",
    "When are receipts due after a purchase?",
  ],
  governance: [
    "How is the Student Body President removed from office?",
    "Who can call a special session of the Senate?",
    "How is a bill passed in the Senate?",
  ],
  elections: [
    "How much can a candidate spend on a campaign?",
    "What is the Elections Commission?",
    "What does the Student Supreme Court decide?",
  ],
  agencies: ["How is an agency director selected?", "What is the Women Student Union?", "How do I join a class council?"],
  cogs: ["How do graduate organizations get funding?", "What is the Congress of Graduate Students?"],
  meetings: ["When does the Student Senate meet?", "What was on the latest RSOAC agenda?"],
  resources: ["Does SGA offer free legal advice?", "Where can students get free tax help?"],
};
