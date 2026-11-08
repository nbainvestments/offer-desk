"use client";
import { useState, useRef, useEffect } from "react";

type Msg = { role: "user" | "ai"; content: string };

/** Minimal formatting: **bold**, and "* " / "- " bullets -> "• ". */
function Fmt({ text }: { text: string }) {
  const t = text.replace(/^\s*[*-]\s+/gm, "• ").replace(/^#{1,4}\s*/gm, "");
  return <>{t.split(/(\*\*[^*]+\*\*)/g).map((part, i) => part.startsWith("**") && part.endsWith("**") ? <b key={i}>{part.slice(2, -2)}</b> : <span key={i}>{part}</span>)}</>;
}

export default function DealChat({ listingId, initial }: { listingId: number; initial: Msg[] }) {
  const [msgs, setMsgs] = useState<Msg[]>(initial);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [msgs, busy]);

  async function ask(question: string | null) {
    setBusy(true); setErr("");
    if (question) setMsgs((m) => [...m, { role: "user", content: question }]);
    else setMsgs((m) => [...m, { role: "user", content: "Give me your take on this deal." }]);
    setQ("");
    try {
      const r = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ listingId, question }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Failed");
      setMsgs((m) => [...m, { role: "ai", content: j.answer }]);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
      setMsgs((m) => m.slice(0, -1));
    } finally { setBusy(false); }
  }
  async function clear() {
    await fetch(`/api/chat?listingId=${listingId}`, { method: "DELETE" });
    setMsgs([]);
  }

  return (
    <div className="card">
      <h3 style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        AI deal advisor
        {msgs.length > 0 && <button className="ghost" onClick={clear} style={{ fontSize: 12, padding: "3px 8px" }}>Clear</button>}
      </h3>
      <p className="sub" style={{ marginTop: 0 }}>Reads this listing's MLS data, comps, photos read, flood and tax record. Estimates are labeled — verify before you offer.</p>
      <div style={{ maxHeight: 520, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, marginBottom: 10 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "stretch", maxWidth: m.role === "user" ? "85%" : "100%",
            background: m.role === "user" ? "#1d2a44" : "#0f1114", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 11px", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
            {m.role === "ai" ? <Fmt text={m.content} /> : m.content}
          </div>
        ))}
        {busy && <div className="sub">Thinking…</div>}
        <div ref={end} />
      </div>
      {err && <p className="note">{err}</p>}
      {msgs.length === 0 && !busy && <button onClick={() => ask(null)} style={{ marginBottom: 8 }}>Get AI's take on this deal</button>}
      <form onSubmit={(e) => { e.preventDefault(); if (q.trim() && !busy) ask(q.trim()); }} style={{ display: "flex", gap: 6 }}>
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about this listing… e.g. what would you offer? is the ARV solid?" style={{ flex: 1 }} disabled={busy} />
        <button disabled={busy || !q.trim()}>Ask</button>
      </form>
    </div>
  );
}
