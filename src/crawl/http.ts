import { parseRobots, type RobotsRules } from "./robots.js";

export const USER_AGENT =
  "rso-funding-assistant/0.3 (student project indexing public FSU SGA documents; https://github.com/Amm1el/rso-funding-assistant)";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A polite fetcher: one request at a time per host with a delay between them, robots.txt
 * honored, retries with backoff on 429/5xx, and an honest User-Agent.
 */
export class PoliteFetcher {
  private robots = new Map<string, Promise<RobotsRules>>();
  private nextSlot = new Map<string, number>();
  readonly skippedByRobots: string[] = [];

  constructor(private delayMs = 400) {}

  private robotsFor(origin: string): Promise<RobotsRules> {
    let r = this.robots.get(origin);
    if (!r) {
      r = fetch(`${origin}/robots.txt`, { headers: { "User-Agent": USER_AGENT } })
        .then(async (res) => parseRobots(res.ok ? await res.text() : ""))
        .catch(() => parseRobots(""));
      this.robots.set(origin, r);
    }
    return r;
  }

  async allowed(url: string): Promise<boolean> {
    const u = new URL(url);
    return (await this.robotsFor(u.origin)).allows(u.pathname + u.search);
  }

  /** Waits for this host's turn, so requests to one host are spaced out. */
  private async turn(host: string) {
    const now = Date.now();
    const at = Math.max(now, this.nextSlot.get(host) ?? 0);
    this.nextSlot.set(host, at + this.delayMs);
    if (at > now) await sleep(at - now);
  }

  /** Returns null when robots.txt disallows the URL. */
  async get(url: string, init: RequestInit = {}, opts: { checkRobots?: boolean } = {}): Promise<Response | null> {
    if (opts.checkRobots !== false && !(await this.allowed(url))) {
      this.skippedByRobots.push(url);
      return null;
    }
    const host = new URL(url).host;
    for (let attempt = 0; ; attempt++) {
      await this.turn(host);
      try {
        const res = await fetch(url, {
          ...init,
          redirect: "follow",
          headers: { "User-Agent": USER_AGENT, ...(init.headers ?? {}) },
          signal: AbortSignal.timeout(60_000),
        });
        if ((res.status === 429 || res.status >= 500) && attempt < 3) {
          await sleep(2000 * 2 ** attempt);
          continue;
        }
        return res;
      } catch (err) {
        if (attempt >= 2) throw err;
        await sleep(2000 * 2 ** attempt);
      }
    }
  }
}
