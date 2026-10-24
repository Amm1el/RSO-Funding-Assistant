import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  askQuestion,
  fetchCollections,
  fetchDirectory,
  fetchHealth,
  pageLabel,
  type AskResponse,
  type Collection,
  type Directory,
  type Health,
  type Passage,
} from "./api";
import { highlight } from "./highlight";
import { EXAMPLES } from "./sections";

interface Exchange {
  id: number;
  question: string;
  collection: string | null;
  status: "asking" | "done" | "error";
  response?: AskResponse;
  error?: string;
}

type Tab = "all" | "directory" | string;

export function App() {
  const [tab, setTab] = useState<Tab>("all");
  const [collections, setCollections] = useState<Collection[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [draft, setDraft] = useState("");
  const [inputError, setInputError] = useState("");
  const nextId = useRef(1);
  const busy = exchanges.some((e) => e.status === "asking");

  useEffect(() => {
    fetchCollections().then(setCollections).catch(() => setCollections([]));
    fetchHealth().then(setHealth).catch(() => setHealth(null));
  }, []);

  const labels = useMemo(() => Object.fromEntries(collections.map((c) => [c.id, c.label])), [collections]);
  const current = collections.find((c) => c.id === tab);
  const collection = tab === "all" || tab === "directory" ? null : tab;
  const shown = exchanges.filter((e) => e.collection === collection);

  async function submit(question: string) {
    const q = question.trim();
    if (q.length < 3) {
      setInputError("Type a question of at least 3 characters.");
      return;
    }
    const id = nextId.current++;
    setDraft("");
    setInputError("");
    setExchanges((prev) => [...prev, { id, question: q, collection, status: "asking" }]);
    try {
      const response = await askQuestion(q, collection);
      setExchanges((prev) => prev.map((e) => (e.id === id ? { ...e, status: "done", response } : e)));
    } catch (err) {
      setExchanges((prev) => prev.map((e) => (e.id === id ? { ...e, status: "error", error: (err as Error).message } : e)));
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!busy) void submit(draft);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!busy) void submit(draft);
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "all", label: "All sources" },
    ...collections.filter((c) => c.chunks > 0).map((c) => ({ id: c.id, label: c.label })),
    { id: "directory", label: "Directory" },
  ];

  return (
    <>
      <div className="utility">
        <div className="wrap">Unofficial student-built tool for FSU students and student organizations</div>
      </div>
      <header className="masthead">
        <div className="wrap">
          <p className="kicker">Florida State University Student Government, 2026–27</p>
          <h1>SGA Assistant</h1>
          <p className="lede">
            Answers from what SGA publishes: the Financial Manual, the Constitution and Statutes, COGS code, sga.fsu.edu and its
            agencies, linked documents, and meeting agendas. Every answer shows the passage it came from.
          </p>
        </div>
      </header>

      <nav className="sections" aria-label="Sections">
        <div className="wrap">
          <div className="tabs" role="tablist">
            {tabs.map((t) => (
              <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} className={tab === t.id ? "tab active" : "tab"} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <main className="wrap">
        <ModeBanner health={health} />

        {tab === "directory" ? (
          <DirectoryView labels={labels} />
        ) : (
          <>
            {current && (
              <section className="section-intro">
                <h2>{current.label}</h2>
                <p>{current.blurb}</p>
              </section>
            )}

            {shown.length === 0 && (
              <section className="examples" aria-label="Example questions">
                <p>Try one of these:</p>
                <ul>
                  {(EXAMPLES[collection ?? "all"] ?? EXAMPLES.all).map((q) => (
                    <li key={q}>
                      <button type="button" onClick={() => void submit(q)} disabled={busy}>
                        {q}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <ol className="thread" aria-live="polite">
              {shown.map((ex) => (
                <ExchangeView key={ex.id} exchange={ex} labels={labels} showSection={!collection} />
              ))}
            </ol>

            <form className="ask" onSubmit={onSubmit}>
              <label htmlFor="question">{current ? `Ask about ${current.label.toLowerCase()}` : "Your question"}</label>
              <div className="ask-row">
                <textarea
                  id="question"
                  rows={2}
                  maxLength={500}
                  value={draft}
                  placeholder="e.g. What's the hotel limit per night?"
                  aria-invalid={inputError ? true : undefined}
                  aria-describedby={inputError ? "question-error" : undefined}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    if (inputError) setInputError("");
                  }}
                  onKeyDown={onKeyDown}
                />
                <button type="submit" disabled={busy}>
                  {busy ? "Asking…" : "Ask"}
                </button>
              </div>
              {inputError && (
                <p id="question-error" className="field-error">
                  {inputError}
                </p>
              )}
            </form>
          </>
        )}
      </main>

      <footer className="site-footer">
        <div className="wrap">
          <p>
            Not official SGA or FSU advice. When something isn't in the sources, the assistant says so. For funding questions, contact
            SGA Accounting: Student Union 3268, (850) 644-7574, <a href="mailto:sgaaccounting@fsu.edu">sgaaccounting@fsu.edu</a>.
          </p>
          <p>
            Sources: <a href="https://sga.fsu.edu/">sga.fsu.edu</a>, <a href="https://fsusga.municipalcodeonline.com/">SGA code books</a>,{" "}
            <a href="https://fsusga.portal.civicclerk.com/">SGA meeting portal</a>
            {health?.updatedAt ? `, collected ${new Date(health.updatedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}` : ""}.
          </p>
        </div>
      </footer>
    </>
  );
}

/** Says which mode the app is in and how much it's searching. */
function ModeBanner({ health }: { health: Health | null }) {
  if (!health) return null;
  const ai = health.generator !== "extractive";
  const scope = `Searching ${health.sources.toLocaleString()} ${health.sources === 1 ? "source" : "sources"}.`;
  return (
    <p className={ai ? "mode-banner ai" : "mode-banner"}>
      {scope}{" "}
      {ai
        ? "AI answers on: each answer is written from the retrieved passages, and every quote is checked against them."
        : "Running without AI: answers are the closest sentences, quoted straight from the sources. No API keys in use."}
    </p>
  );
}

function ExchangeView({ exchange, labels, showSection }: { exchange: Exchange; labels: Record<string, string>; showSection: boolean }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (exchange.status !== "asking") ref.current?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [exchange.status]);

  return (
    <li className="exchange" ref={ref}>
      <p className="question">{exchange.question}</p>
      {exchange.status === "asking" && <p className="pending">Searching…</p>}
      {exchange.status === "error" && <p className="error">{exchange.error}</p>}
      {exchange.response && <AnswerView response={exchange.response} labels={labels} showSection={showSection} />}
    </li>
  );
}

function AnswerView({ response, labels, showSection }: { response: AskResponse; labels: Record<string, string>; showSection: boolean }) {
  const citedIds = new Set(response.citations.map((c) => c.chunkId));
  const cited = response.passages.filter((p) => citedIds.has(p.id));
  const others = response.passages.filter((p) => !citedIds.has(p.id));
  const quotesFor = (p: Passage) => response.citations.filter((c) => c.chunkId === p.id).map((c) => c.quote);

  return (
    <div className={response.answerable ? "answer" : "answer not-covered"}>
      {!response.answerable && <p className="verdict">The sources don't answer this.</p>}
      {response.generator === "extractive" && response.answerable && (
        <p className="mode-note">Closest match, quoted from the sources. It may not fully answer the question.</p>
      )}
      <p className="answer-text">{response.answer}</p>

      {cited.length > 0 && (
        <section className="sources" aria-label="Where this comes from">
          <h3>Where this comes from</h3>
          {cited.map((p) => (
            <PassageView key={p.id} passage={p} quotes={quotesFor(p)} label={showSection && p.collection ? labels[p.collection] : undefined} />
          ))}
        </section>
      )}

      {others.length > 0 && (
        <details className="others">
          <summary>
            {response.answerable ? "Other passages searched" : "Closest passages in the sources"} ({others.length})
          </summary>
          {others.map((p) => (
            <PassageView key={p.id} passage={p} quotes={[]} label={showSection && p.collection ? labels[p.collection] : undefined} />
          ))}
        </details>
      )}
    </div>
  );
}

function PassageView({ passage, quotes, label }: { passage: Passage; quotes: string[]; label?: string }) {
  const pages = pageLabel(passage.pageStart, passage.pageEnd);
  return (
    <figure className="passage">
      <figcaption>
        <span className="source-line">
          {passage.title && passage.title !== passage.section && <span className="source-title">{passage.title}</span>}
          <span className="section">{passage.section}</span>
        </span>
        <span className="meta">
          {label && <span className="chip">{label}</span>}
          {pages && <span className="pages">{pages}</span>}
          {passage.url && (
            <a href={passage.url} target="_blank" rel="noopener noreferrer">
              View source
            </a>
          )}
        </span>
      </figcaption>
      <blockquote>
        {highlight(passage.content, quotes).map((seg, i) => (seg.marked ? <mark key={i}>{seg.text}</mark> : <span key={i}>{seg.text}</span>))}
      </blockquote>
    </figure>
  );
}

function DirectoryView({ labels }: { labels: Record<string, string> }) {
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    fetchDirectory().then(setDirectory).catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!directory) return <p className="pending">Loading the directory…</p>;

  const f = filter.trim().toLowerCase();
  const match = (...fields: (string | undefined)[]) => !f || fields.some((x) => x?.toLowerCase().includes(f));
  const contacts = directory.contacts.filter((c) => match(c.name, c.email, c.location, c.phone, labels[c.collection]));
  const rooms = directory.places.filter((p) => !p.online && match(p.name, ...p.usedBy));
  const upcoming = (directory.upcoming ?? []).filter((m) => match(m.title, m.category, m.where)).slice(0, 8);
  const groups = new Map<string, typeof contacts>();
  for (const c of contacts) groups.set(c.collection, [...(groups.get(c.collection) ?? []), c]);
  const when = (iso: string) =>
    new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <div className="directory">
      <section className="section-intro">
        <h2>Directory</h2>
        <p>Offices, positions and meeting places, found across SGA's pages, code books and meeting records.</p>
      </section>
      <label className="filter" htmlFor="directory-filter">
        Filter
        <input id="directory-filter" type="search" value={filter} placeholder="e.g. treasurer, elections, Student Union" onChange={(e) => setFilter(e.target.value)} />
      </label>

      {upcoming.length > 0 && (
        <section className="dir-block">
          <h3>Coming up</h3>
          <ul className="dir-list">
            {upcoming.map((m) => (
              <li key={m.url}>
                <span className="dir-name">
                  <a href={m.url} target="_blank" rel="noopener noreferrer">
                    {m.title}
                  </a>
                </span>
                <span className="dir-detail">
                  {when(m.date)}
                  {m.where ? `, ${m.where}` : ""}
                </span>
                <span className="chip">{m.category}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="dir-block">
        <h3>Contacts ({contacts.length})</h3>
        {contacts.length === 0 && <p className="pending">No contacts match “{filter}”.</p>}
        {[...groups].map(([collection, items]) => (
          <div key={collection} className="dir-group">
            <h4>{labels[collection] ?? collection}</h4>
            <ul className="dir-list">
              {items.map((c) => (
                <li key={c.email ?? c.name}>
                  <span className="dir-name">{c.name}</span>
                  <span className="dir-detail">
                    {c.email && <span className="copyable">{c.email}</span>}
                    {c.phone && <span>{c.phone}</span>}
                    {c.location && <span>{c.location}</span>}
                  </span>
                  <a className="dir-source" href={c.source.url} target="_blank" rel="noopener noreferrer">
                    {c.source.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {rooms.length > 0 && (
        <section className="dir-block">
          <h3>Where SGA meets</h3>
          <ul className="dir-list">
            {rooms.map((p) => (
              <li key={p.name}>
                <span className="dir-name">{p.name}</span>
                <span className="dir-detail">
                  {p.meetings} {p.meetings === 1 ? "meeting" : "meetings"}: {p.usedBy.slice(0, 3).join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
