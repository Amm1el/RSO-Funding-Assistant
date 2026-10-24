/**
 * Example questions per section. Each was checked against the crawled sources (see
 * scripts/check-examples.ts), so the ones shown in a demo are ones the sources answer.
 */
export const EXAMPLES: Record<string, string[]> = {
  all: [
    "What's the most RSOAC will fund per organization this year?",
    "Who runs SGA elections?",
    "When does the Student Senate meet?",
    "Can SGA pay for our members' tuition?",
  ],
  funding: [
    "What's the most RSOAC will fund per organization this year?",
    "What is the maximum hotel rate per night?",
    "Will SGA reimburse Uber rides on a trip?",
    "When are receipts due after a purchase?",
  ],
  governance: [
    "How is the Student Body President removed from office?",
    "What does the SGA Sunshine Act require?",
    "How many senators are in the Student Senate?",
  ],
  elections: [
    "Who runs SGA elections?",
    "How much can a candidate spend on a campaign?",
    "What does the Student Supreme Court decide?",
  ],
  agencies: ["What are the SGA agencies?", "What does the Union Board do?", "How do I join a class council?"],
  cogs: ["How do graduate organizations get funding?", "What is the Congress of Graduate Students?"],
  meetings: ["When does the Student Senate meet?", "What was on the latest RSOAC agenda?"],
  resources: ["Does SGA offer free legal advice?", "Where can students get free tax help?"],
};
