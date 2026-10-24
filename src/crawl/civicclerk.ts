import type { PoliteFetcher } from "./http.js";
import type { CorpusDoc, CorpusSection } from "./types.js";
import { docId } from "./ids.js";

export const CIVICCLERK_API = "https://fsusga.api.civicclerk.com/v1";
export const CIVICCLERK_PORTAL = "https://fsusga.portal.civicclerk.com";

interface CcEvent {
  id: number;
  eventName: string;
  startDateTime: string;
  categoryName: string;
  eventLocation?: { address1?: string | null; address2?: string | null };
  publishedFiles?: { fileId: number; type: string; name: string }[];
}

/**
 * Meetings from the public CivicClerk API that the SGA meeting portal itself uses: every
 * event in the window (Senate, COGS, funding boards, agencies...) plus the plain-text
 * version of each published agenda and minutes.
 */
export async function crawlMeetings(fetcher: PoliteFetcher, log: (m: string) => void, opts: { monthsBack: number }) {
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() - opts.monthsBack * 30.5 * 86400_000).toISOString();
  const events: CcEvent[] = [];

  const page = async (query: string) => {
    const res = await fetcher.get(`${CIVICCLERK_API}/Events/GetEventsList(${query})`);
    if (!res?.ok) throw new Error(`CivicClerk events ${res?.status}`);
    return (await res.json()) as { items: CcEvent[]; hasMore: boolean };
  };

  // Past events, newest first, until the cutoff.
  for (let skip = 0; ; ) {
    const { items, hasMore } = await page(`fromDate='',toDate='${today}',categoryIds=[],skip=${skip},sortDescending=true,cursorId=0`);
    const keep = items.filter((e) => e.startDateTime >= cutoff);
    events.push(...keep);
    skip += items.length;
    if (!hasMore || !items.length || keep.length < items.length) break;
  }
  // Upcoming events.
  for (let skip = 0; skip < 200; ) {
    const { items, hasMore } = await page(`fromDate='${today}',toDate='',categoryIds=[],skip=${skip},sortDescending=false,cursorId=0`);
    events.push(...items);
    skip += items.length;
    if (!hasMore || !items.length) break;
  }
  log(`  ${events.length} meetings since ${cutoff.slice(0, 10)}`);

  const docs: CorpusDoc[] = [];
  const seen = new Set<number>();
  for (const e of events) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const when = new Date(e.startDateTime);
    const where = [e.eventLocation?.address1, e.eventLocation?.address2].filter(Boolean).join(", ");
    const sections: CorpusSection[] = [
      {
        heading: "Meeting details",
        text: `${e.eventName}\nCategory: ${e.categoryName}\nWhen: ${when.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" })}${where ? `\nWhere: ${where}` : ""}`,
      },
    ];
    for (const f of e.publishedFiles ?? []) {
      const fileUrl = `${CIVICCLERK_PORTAL}/event/${e.id}/files/${(f.type || "agenda").toLowerCase()}/${f.fileId}`;
      const res = await fetcher.get(`${CIVICCLERK_API}/Meetings/GetMeetingFileStream(fileId=${f.fileId},plainText=true)`);
      if (!res?.ok) continue;
      const text = (await res.text()).replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
      if (text) sections.push({ heading: f.name || f.type, text, url: fileUrl });
    }
    const url = `${CIVICCLERK_PORTAL}/event/${e.id}/files`;
    docs.push({
      id: docId(url),
      url,
      title: `${e.eventName} (${when.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" })})`,
      kind: "meeting",
      host: new URL(CIVICCLERK_PORTAL).host,
      fetchedAt: new Date().toISOString(),
      sections,
      meta: { category: e.categoryName, date: e.startDateTime, upcoming: e.startDateTime >= new Date().toISOString() },
    });
  }
  return docs;
}
