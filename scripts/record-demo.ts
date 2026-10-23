// Records docs/demo.gif: a scripted session against a running server.
// Usage: npm start (in another terminal), then npx tsx scripts/record-demo.ts [http://localhost:3000]
// Needs Playwright's Chromium (npx playwright install chromium) and ffmpeg.
import { chromium, type Page } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] ?? "http://localhost:3000";
const size = { width: 1000, height: 760 };
const videoDir = mkdtempSync(join(tmpdir(), "rso-demo-"));

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext({ viewport: size, recordVideo: { dir: videoDir, size } });
const page = await context.newPage();

async function ask(p: Page, question: string, index: number) {
  await p.click("#question");
  await p.keyboard.type(question, { delay: 35 });
  await p.waitForTimeout(400);
  await p.keyboard.press("Enter");
  await p.locator(".exchange").nth(index).locator(".answer").waitFor();
  await p.waitForTimeout(600);
  await p.locator(".exchange").nth(index).locator(".passage, .others").first().scrollIntoViewIfNeeded();
  await p.waitForTimeout(2200);
}

await page.goto(base);
await page.waitForTimeout(1200);
await ask(page, "Will SGA reimburse Uber or Lyft rides on a trip?", 0);
await ask(page, "What is the maximum hotel rate per night?", 1);
await ask(page, "Can SGA pay for parking passes for our members?", 2);
await page.waitForTimeout(800);
await context.close();
await browser.close();

const video = join(videoDir, readdirSync(videoDir).find((f) => f.endsWith(".webm"))!);
// Two-pass palette keeps the GIF sharp and small.
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-vf", "fps=8,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4", "docs/demo.gif"]);
rmSync(videoDir, { recursive: true, force: true });
console.log("Wrote docs/demo.gif");
