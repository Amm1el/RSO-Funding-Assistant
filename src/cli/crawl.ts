import { crawl, type CrawlSource } from "../crawl/index.js";

/*
Usage: npm run crawl -- [--out corpus] [--only site,documents,code,meetings]
                        [--max-pages 1500] [--max-documents 3000] [--meeting-months 24]
Runs in GitHub Actions (.github/workflows/crawl.yml); also works on any machine with internet
access (the code books need `npx playwright install chromium`).
*/
const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const manifest = await crawl({
  outDir: flag("--out") ?? "corpus",
  sources: (flag("--only") ?? "site,documents,code,meetings").split(",") as CrawlSource[],
  maxPages: Number(flag("--max-pages") ?? 1500),
  maxDocuments: Number(flag("--max-documents") ?? 3000),
  maxDocumentBytes: 30 * 1024 * 1024,
  meetingMonths: Number(flag("--meeting-months") ?? 24),
});
if (Object.keys(manifest.counts).length === 0) process.exit(1);
