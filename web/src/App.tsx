import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { askQuestion, pageLabel, type AskResponse, type Passage } from "./api";
import { highlight } from "./highlight";

interface Exchange {
  id: number;
  question: string;
  status: "asking" | "done" | "error";
  response?: AskResponse;
  error?: string;
}

const EXAMPLES = [
  "What's the most RSOAC can give us this year?",
  "Can we buy food for an officer meeting with 6 people?",
  "How far ahead does a trip need approval in FSU HQ?",
  "Will SGA reimburse Uber rides on a trip?",
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
    <div className="page">
      <header className="masthead">
        <h1>Ask the RSO Financial Manual</h1>
        <p className="lede">
          Questions about SGA funding for FSU student organizations, answered only from the 2026–27 Registered Student Organization
          Financial Manual. Every answer shows the passage it came from.
        </p>
      </header>

      <main>
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

        <p className="disclaimer">
          Not official SGA advice. When something isn't in the manual, it says so. For anything else, contact SGA Accounting at{" "}
          <a href="mailto:sgaaccounting@fsu.edu">sgaaccounting@fsu.edu</a>.
        </p>
      </main>
    </div>
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
          Closest match in the manual. AI answers are off on this server, so this is a direct quote and may not fully answer the question.
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
