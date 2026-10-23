import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { askQuestion, fetchHealth, pageLabel, type AskResponse, type Health, type Passage } from "./api";
import { highlight } from "./highlight";

interface Exchange {
  id: number;
  question: string;
  status: "asking" | "done" | "error";
  response?: AskResponse;
  error?: string;
}

// Chosen to work in both modes, including one the manual doesn't cover (it should refuse).
const EXAMPLES = [
  "What's the most RSOAC will fund per organization this year?",
  "What is the maximum hotel rate per night?",
  "Will SGA reimburse Uber rides on a trip?",
  "When are receipts due after a purchase?",
  "Can SGA pay for parking passes for our members?",
];

export function App() {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [draft, setDraft] = useState("");
  const [inputError, setInputError] = useState("");
  const nextId = useRef(1);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = exchanges.some((e) => e.status === "asking");

  async function submit(question: string) {
    const q = question.trim();
    if (q.length < 3) {
      setInputError("Type a question of at least 3 characters.");
      return;
    }
    const id = nextId.current++;
    setDraft("");
    setInputError("");
    setExchanges((prev) => [...prev, { id, question: q, status: "asking" }]);
    try {
      const response = await askQuestion(q);
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

  return (
    <>
      <div className="utility">
        <div className="wrap">Unofficial student-built tool for FSU registered student organizations</div>
      </div>
      <header className="masthead">
        <div className="wrap">
          <p className="kicker">SGA funding, 2026–27</p>
          <h1>RSO Funding Assistant</h1>
          <p className="lede">
            Ask about RSOAC requests, travel, purchasing, and receipts. Answers come only from the 2026–27 Registered Student
            Organization Financial Manual, and every answer shows the passage it came from.
          </p>
        </div>
      </header>

      <main className="wrap">
        <ModeBanner />
        {exchanges.length === 0 && (
          <section className="examples" aria-label="Example questions">
            <p>Try one of these:</p>
            <ul>
              {EXAMPLES.map((q) => (
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
          {exchanges.map((ex) => (
            <ExchangeView key={ex.id} exchange={ex} />
          ))}
        </ol>

        <form className="ask" onSubmit={onSubmit}>
          <label htmlFor="question">Your question</label>
          <div className="ask-row">
            <textarea
              id="question"
              ref={inputRef}
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

      </main>

      <footer className="site-footer">
        <div className="wrap">
          <p>
            Not official SGA or FSU advice. When something isn't in the manual, the assistant says so. For anything else, contact SGA
            Accounting: Student Union 3268, (850) 644-7574, <a href="mailto:sgaaccounting@fsu.edu">sgaaccounting@fsu.edu</a>.
          </p>
          <p>
            Source:{" "}
            <a href="https://sga.fsu.edu/sites/default/files/PDFs/Accounting/26-27SGAFM.pdf">2026–27 RSO Financial Manual (PDF)</a>
          </p>
        </div>
      </footer>
    </>
  );
}

/** Says which mode the server is in, so a demo without API keys is labeled as such. */
function ModeBanner() {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    fetchHealth().then(setHealth).catch(() => setHealth(null));
  }, []);
  if (!health) return null;
  const ai = health.generator !== "extractive";
  return (
    <p className={ai ? "mode-banner ai" : "mode-banner"}>
      {ai
        ? "AI answers on: Claude writes each answer from the retrieved passages, and every quote is checked against the manual."
        : "Running without AI: answers are the closest sentences quoted straight from the manual. No API keys in use."}
    </p>
  );
}

function ExchangeView({ exchange }: { exchange: Exchange }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (exchange.status !== "asking") ref.current?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [exchange.status]);

  return (
    <li className="exchange" ref={ref}>
      <p className="question">{exchange.question}</p>
      {exchange.status === "asking" && <p className="pending">Searching the manual…</p>}
      {exchange.status === "error" && <p className="error">{exchange.error}</p>}
      {exchange.response && <AnswerView response={exchange.response} />}
    </li>
  );
}

function AnswerView({ response }: { response: AskResponse }) {
  const citedIds = new Set(response.citations.map((c) => c.chunkId));
  const cited = response.passages.filter((p) => citedIds.has(p.id));
  const others = response.passages.filter((p) => !citedIds.has(p.id));
  const quotesFor = (p: Passage) => response.citations.filter((c) => c.chunkId === p.id).map((c) => c.quote);

  return (
    <div className={response.answerable ? "answer" : "answer not-covered"}>
      {!response.answerable && <p className="verdict">The manual doesn't answer this.</p>}
      {response.generator === "extractive" && response.answerable && (
        <p className="mode-note">
          Closest match, quoted from the manual. It may not fully answer the question.
        </p>
      )}
      <p className="answer-text">{response.answer}</p>

      {cited.length > 0 && (
        <section className="sources" aria-label="Where this comes from">
          <h2>Where this comes from</h2>
          {cited.map((p) => (
            <PassageView key={p.id} passage={p} quotes={quotesFor(p)} />
          ))}
        </section>
      )}

      {others.length > 0 && (
        <details className="others">
          <summary>
            {response.answerable ? "Other passages searched" : "Closest passages in the manual"} ({others.length})
          </summary>
          {others.map((p) => (
            <PassageView key={p.id} passage={p} quotes={[]} />
          ))}
        </details>
      )}
    </div>
  );
}

function PassageView({ passage, quotes }: { passage: Passage; quotes: string[] }) {
  return (
    <figure className="passage">
      <figcaption>
        <span className="section">{passage.section}</span>
        <span className="pages">{pageLabel(passage.pageStart, passage.pageEnd)}</span>
      </figcaption>
      <blockquote>
        {highlight(passage.content, quotes).map((seg, i) => (seg.marked ? <mark key={i}>{seg.text}</mark> : <span key={i}>{seg.text}</span>))}
      </blockquote>
    </figure>
  );
}
