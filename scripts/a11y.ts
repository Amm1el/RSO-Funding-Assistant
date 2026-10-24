// Accessibility audit (axe-core, WCAG 2.1 AA) of the phone build: home, an answer, and the
// Directory, in light and dark mode. Exits 1 on any serious or critical violation.
// Usage: npm run build:static && npx tsx scripts/a11y.ts
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const axe = readFileSync(resolve("node_modules/axe-core/axe.min.js"), "utf8");
const url = "file://" + resolve("web/dist-static/index.html");
// CHROMIUM_PATH lets a machine with a different Playwright browser build run it.
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let serious = 0;
for (const scheme of ["light", "dark"] as const) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
  await page.goto(url);
  const example = page.locator("button", { hasText: "most RSOAC" }).first();
  await example.waitFor();
  const audit = async (label: string) => {
    await page.addScriptTag({ content: axe });
    const result = await page.evaluate(async () => (window as any).axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] }));
    for (const v of result.violations as any[]) {
      if (v.impact === "serious" || v.impact === "critical") serious++;
      console.log(`[${scheme}/${label}] ${v.impact}: ${v.id} (${v.nodes.length}) ${v.help}`);
      for (const n of v.nodes.slice(0, 3)) console.log(`    ${n.target.join(" ")}  ${n.failureSummary?.split("\n")[1]?.trim() ?? ""}`);
    }
  };
  await audit("home");
  await example.click();
  await page.locator("text=Where this comes from").waitFor({ timeout: 30000 });
  await audit("answer");
  await page.locator("button", { hasText: /^Directory$/ }).first().click();
  await page.waitForTimeout(800);
  await page.locator("details.changes summary").first().click().catch(() => {});
  await audit("directory");
  await page.close();
}
await browser.close();
console.log(serious ? `${serious} serious/critical violations` : "No serious or critical violations.");
process.exit(serious ? 1 : 0);
