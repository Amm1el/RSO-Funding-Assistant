// Records docs/demo.gif: a scripted session against the app.
// Usage: npm run build:static, then npx tsx scripts/record-demo.ts  (or pass a server URL, e.g. http://localhost:3000)
// Needs Playwright's Chromium (npx playwright install chromium) and ffmpeg. Frames are
// screenshots taken on a timer (not Playwright's video recorder, which needs its own ffmpeg build).
import { chromium, type Page } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] ?? "file://" + join(process.cwd(), "web/dist-static/index.html");
const size = { width: 1000, height: 760 };
const frameDir = mkdtempSync(join(tmpdir(), "rso-demo-"));
const FPS = 8;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext({ viewport: size });
const page = await context.newPage();

// Screenshot loop: each capture is written as the next frame; slow captures repeat the
// previous frame so playback keeps real time.
let frames = 0;
let recording = true;
const recorder = (async () => {
  const start = Date.now();
  while (recording) {
    const shot = await page.screenshot({ type: "png" }).catch(() => null);
    const due = Math.floor(((Date.now() - start) / 1000) * FPS);
    if (shot) while (frames <= due) writeFileSync(join(frameDir, `f${String(frames++).padStart(5, "0")}.png`), shot);
  }
})();

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

const tab = async (name: RegExp) => {
  await page.getByRole("tab", { name }).click();
  await page.waitForTimeout(900);
};

await page.goto(base);
await page.waitForTimeout(2500);
await tab(/Funding/);
await ask(page, "What is the maximum hotel rate per night?", 0);
await tab(/Constitution/);
await ask(page, "Who can call a special session of the Senate?", 0);
await tab(/^Directory$/);
await page.locator("details.changes summary").first().click();
await page.waitForTimeout(1200);
await page.locator("details.changes").first().scrollIntoViewIfNeeded();
await page.waitForTimeout(2600);
await page.mouse.wheel(0, 700);
await page.waitForTimeout(1800);
recording = false;
await recorder;
await context.close();
await browser.close();

// Two-pass palette keeps the GIF sharp and small.
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(frameDir, "f%05d.png"), "-vf", "fps=8,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4", "docs/demo.gif"]);
rmSync(frameDir, { recursive: true, force: true });
console.log("Wrote docs/demo.gif");
