"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { CvDoc, Preferences } from "@/lib/agent/types";

async function post(url: string, body: unknown, method = "POST") {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const extra = [...(data.details ?? []), ...(data.issues ?? [])].join(" · ");
    throw new Error([data.error ?? `Request failed (${res.status})`, extra].filter(Boolean).join(": "));
  }
  return data;
}

export function Act({ url, body, method, children, variant = "", confirm, goto, small, disabled }: { url: string; body: unknown; method?: string; children: ReactNode; variant?: string; confirm?: string; goto?: string; small?: boolean; disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span>
      <button
        className={`btn ${variant} ${small ? "sm" : ""}`}
        disabled={busy || disabled}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          setBusy(true);
          setErr(null);
          try {
            const d = await post(url, body, method);
            if (goto) router.push(goto.replace("{cvId}", d.cvId ?? "").replace("{jobId}", d.jobId ?? ""));
            else router.refresh();
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Working…" : children}
      </button>
      {err ? <div role="alert" className="notice bad" style={{ marginTop: 8, maxWidth: 520 }}>{err}</div> : null}
    </span>
  );
}

export type Field = { name: string; label: string; type?: "text" | "url" | "textarea" | "select" | "number"; options?: string[]; placeholder?: string; hint?: string; required?: boolean; rows?: number };

export function JsonForm({ url, method = "POST", fields, submit, constants = {}, goto, resetOnSuccess = true }: { url: string; method?: string; fields: Field[]; submit: string; constants?: Record<string, unknown>; goto?: string; resetOnSuccess?: boolean }) {
  const router = useRouter();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        try {
          const body: Record<string, unknown> = { ...constants };
          for (const f of fields) if (vals[f.name]?.trim()) body[f.name] = f.type === "number" ? Number(vals[f.name]) : vals[f.name].trim();
          const d = await post(url, body, method);
          setMsg({ tone: "ok", text: d.jobId || d.id || d.links !== undefined ? "Added." : "Saved." });
          if (resetOnSuccess) setVals({});
          if (goto) router.push(goto.replace("{jobId}", d.jobId ?? ""));
          else router.refresh();
        } catch (er) {
          setMsg({ tone: "bad", text: (er as Error).message });
        } finally {
          setBusy(false);
        }
      }}
    >
      {fields.map((f) => (
        <div className="field" key={f.name}>
          <label htmlFor={`f-${f.name}`}>
            {f.label} {f.hint ? <span className="hint">{f.hint}</span> : null}
          </label>
          {f.type === "textarea" ? (
            <textarea id={`f-${f.name}`} rows={f.rows ?? 6} required={f.required} placeholder={f.placeholder} value={vals[f.name] ?? ""} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })} />
          ) : f.type === "select" ? (
            <select id={`f-${f.name}`} value={vals[f.name] ?? f.options?.[0] ?? ""} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })}>
              {f.options?.map((o) => <option key={o}>{o}</option>)}
            </select>
          ) : (
            <input id={`f-${f.name}`} type={f.type ?? "text"} required={f.required} placeholder={f.placeholder} value={vals[f.name] ?? ""} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })} />
          )}
        </div>
      ))}
      <div className="btns">
        <button className="btn primary" disabled={busy}>{busy ? "Working…" : submit}</button>
      </div>
      {msg ? <div role={msg.tone === "bad" ? "alert" : "status"} className={`notice ${msg.tone}`} style={{ marginTop: 10 }}>{msg.text}</div> : null}
    </form>
  );
}

export function LoginForm() {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        try {
          await post("/api/agent/login", { password: pw });
          router.push("/agent");
          router.refresh();
        } catch (er) {
          setErr((er as Error).message);
        }
      }}
    >
      <div className="field">
        <label htmlFor="pw">Access password</label>
        <input id="pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
      </div>
      <button className="btn primary">Sign in</button>
      {err ? <div role="alert" className="notice bad" style={{ marginTop: 10 }}>{err}</div> : null}
    </form>
  );
}

export function LogoutButton() {
  const router = useRouter();
  return (
    <button className="btn sm" onClick={async () => { await post("/api/agent/logout", {}); router.push("/agent/login"); router.refresh(); }}>
      Sign out
    </button>
  );
}

export function CvUploadForm({ hasProfile }: { hasProfile: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const input = (e.currentTarget.elements.namedItem("file") as HTMLInputElement);
        const file = input.files?.[0];
        if (!file) return;
        setBusy(true);
        setMsg(null);
        try {
          const fd = new FormData();
          fd.set("file", file);
          const res = await fetch("/api/agent/profile", { method: "POST", body: fd });
          const d = await res.json();
          if (!res.ok) throw new Error(d.error ?? "Upload failed");
          setMsg({ tone: d.warnings?.length ? "warn" : "ok", text: `Imported ${d.entries} entries, ${d.facts} facts and ${d.skills} skills. Nothing is used in a CV until you verify it.${d.warnings?.length ? " Notes: " + d.warnings.join(" ") : ""}` });
          router.refresh();
        } catch (er) {
          setMsg({ tone: "bad", text: (er as Error).message });
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="field">
        <label htmlFor="cv-file">{hasProfile ? "Re-import an updated CV" : "Your current CV"} <span className="hint">PDF, DOCX, TXT or MD, up to 5 MB</span></label>
        <input id="cv-file" name="file" type="file" accept=".pdf,.docx,.txt,.md" required />
      </div>
      <button className="btn primary" disabled={busy}>{busy ? "Reading…" : hasProfile ? "Re-import" : "Import CV"}</button>
      {msg ? <div role={msg.tone === "bad" ? "alert" : "status"} className={`notice ${msg.tone}`} style={{ marginTop: 10 }}>{msg.text}</div> : null}
    </form>
  );
}

export function AnswerInput({ answerId, initial, draft }: { answerId: string; initial: string; draft: string | null }) {
  const router = useRouter();
  const [v, setV] = useState(initial || draft || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <div className="inline-form">
        <input type="text" aria-label="Answer" value={v} onChange={(e) => setV(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
        <button
          className="btn sm"
          disabled={busy || !v.trim()}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await post("/api/agent/applications", { action: "answer", answerId, text: v });
              router.refresh();
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {initial ? "Update" : "Confirm"}
        </button>
      </div>
      {!initial && draft ? <div className="hint" style={{ marginTop: 4 }}>Suggested from your earlier answer; confirm to use it.</div> : null}
      {err ? <div role="alert" className="notice bad" style={{ marginTop: 6 }}>{err}</div> : null}
    </div>
  );
}

export function EmphasisForm({ jobId, parentId, suggestions }: { jobId: string; parentId: string; suggestions: string[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <div className="hint" style={{ marginBottom: 8 }}>Choose skills to bring forward. Only skills you can evidence will appear; the rest are ignored.</div>
      <div className="btns" style={{ marginBottom: 10 }}>
        {suggestions.map((s) => (
          <label key={s} style={{ fontWeight: 500, display: "inline-flex", gap: 5, alignItems: "center", margin: 0 }}>
            <input type="checkbox" checked={sel.includes(s)} onChange={(e) => setSel(e.target.checked ? [...sel, s] : sel.filter((x) => x !== s))} /> {s}
          </label>
        ))}
      </div>
      <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            const d = await post("/api/agent/cv", { action: "regenerate", jobId, parentId, emphasis: sel });
            router.push(`/agent/studio/${jobId}?v=${d.cvId}`);
            router.refresh();
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Generating…" : "Regenerate as new version"}
      </button>
      {err ? <div role="alert" className="notice bad" style={{ marginTop: 8 }}>{err}</div> : null}
    </div>
  );
}

export function CvEditor({ jobId, parentId, doc }: { jobId: string; parentId: string; doc: CvDoc }) {
  const router = useRouter();
  const [d, setD] = useState<CvDoc>(structuredClone(doc));
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const bullets = (key: "experience" | "projects") =>
    d[key].map((s, si) => (
      <div key={s.entryId} style={{ marginBottom: 12 }}>
        <div className="t-title">{s.title} <span className="t-sub">{s.org}</span></div>
        {s.bullets.map((b, bi) => (
          <textarea
            key={bi}
            aria-label={`${s.title} bullet ${bi + 1}`}
            rows={2}
            style={{ marginTop: 6 }}
            value={b.text}
            onChange={(e) => { const n = structuredClone(d); n[key][si].bullets[bi].text = e.target.value; setD(n); }}
          />
        ))}
      </div>
    ));
  return (
    <div>
      <div className="notice info" style={{ marginBottom: 12 }}>Edits are saved as a new version and checked against your verified facts. A bullet that adds a number, skill, title or outcome the evidence does not support will block approval. Add the fact in Settings first if it is true.</div>
      <div className="field"><label htmlFor="ed-sum">Summary</label><textarea id="ed-sum" rows={4} value={d.summary.text} onChange={(e) => setD({ ...d, summary: { ...d.summary, text: e.target.value } })} /></div>
      <h3 style={{ margin: "14px 0 8px" }}>Experience</h3>
      {bullets("experience")}
      <h3 style={{ margin: "14px 0 8px" }}>Projects</h3>
      {bullets("projects")}
      <div className="btns">
        <button
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setRes(null);
            try {
              const r = await post("/api/agent/cv", { action: "edit", jobId, parentId, doc: d });
              setRes({ tone: r.validationPass ? "ok" : "bad", text: r.validationPass ? "Saved as a new version; all claims verified." : `Saved as a new version, but it cannot be approved: ${r.violations.join(" | ")}` });
              router.push(`/agent/studio/${jobId}?v=${r.cvId}`);
              router.refresh();
            } catch (e) {
              setRes({ tone: "bad", text: (e as Error).message });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "Save as new version"}
        </button>
      </div>
      {res ? <div role="status" className={`notice ${res.tone}`} style={{ marginTop: 10 }}>{res.text}</div> : null}
    </div>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="btn sm" onClick={async () => { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}>
      {done ? "Copied" : label}
    </button>
  );
}

export function PrefsForm({ prefs }: { prefs: Preferences }) {
  const router = useRouter();
  const [p, setP] = useState<Preferences>(structuredClone(prefs));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const num = (k: keyof Preferences["weights"]) => (
    <div className="field" key={k}>
      <label htmlFor={`w-${k}`}>{k[0].toUpperCase() + k.slice(1)}</label>
      <input id={`w-${k}`} type="number" step="0.05" min="0" max="1" value={p.weights[k]} onChange={(e) => setP({ ...p, weights: { ...p.weights, [k]: Number(e.target.value) } })} />
    </div>
  );
  const wsum = Object.values(p.weights).reduce((a, b) => a + b, 0);
  const providers = ["greenhouse", "lever", "ashby"];
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        try {
          await post("/api/agent/preferences", p, "PUT");
          setMsg({ tone: "ok", text: "Saved. Re-screening uses the new rules on the next run." });
          router.refresh();
        } catch (er) {
          setMsg({ tone: "bad", text: (er as Error).message });
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="card">
        <h2 style={{ marginBottom: 10 }}>Eligibility rules</h2>
        <div className="row">
          <div className="field"><label htmlFor="minsal">Minimum salary (AED per month)</label><input id="minsal" type="number" min="1" value={p.minSalaryAedMonthly} onChange={(e) => setP({ ...p, minSalaryAedMonthly: Number(e.target.value) })} /><div className="hint">AED {(p.minSalaryAedMonthly * 12).toLocaleString("en-US")} per year. Other currencies and pay periods are converted before comparing.</div></div>
          <div className="field"><label htmlFor="maxsen">Highest seniority to consider</label><select id="maxsen" value={p.maxSeniority} onChange={(e) => setP({ ...p, maxSeniority: e.target.value as Preferences["maxSeniority"] })}>{["INTERN", "JUNIOR", "MID", "SENIOR", "LEAD", "PRINCIPAL"].map((s) => <option key={s}>{s}</option>)}</select></div>
          <div className="field"><label htmlFor="tol">Years-of-experience tolerance</label><input id="tol" type="number" min="0" step="0.5" value={p.yearsTolerance} onChange={(e) => setP({ ...p, yearsTolerance: Number(e.target.value) })} /><div className="hint">A job asking for more than your verified years plus this is rejected.</div></div>
        </div>
        <div className="row">
          <div className="field"><label htmlFor="wa">Work authorisation in the UAE</label><select id="wa" value={p.workAuthorization} onChange={(e) => setP({ ...p, workAuthorization: e.target.value as Preferences["workAuthorization"] })}>{["UNKNOWN", "AUTHORIZED", "NEEDS_SPONSORSHIP"].map((s) => <option key={s}>{s}</option>)}</select><div className="hint">Never guessed. UNKNOWN keeps &ldquo;no sponsorship&rdquo; postings uncertain.</div></div>
          <div className="field"><label htmlFor="emp">Employment types</label><input id="emp" type="text" value={p.employmentTypes.join(", ")} onChange={(e) => setP({ ...p, employmentTypes: e.target.value.split(",").map((s) => s.trim().toUpperCase().replace(/ /g, "_")).filter(Boolean) })} /><div className="hint">e.g. FULL_TIME, CONTRACT</div></div>
          <div className="field"><label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 22 }}><input type="checkbox" checked={p.relocationEnabled} onChange={(e) => setP({ ...p, relocationEnabled: e.target.checked })} /> Consider relocation roles</label><div className="hint">Off: non-UAE on-site jobs are rejected. On: they are flagged for your decision.</div></div>
        </div>
        <div className="field"><label htmlFor="roles">Target roles</label><input id="roles" type="text" value={p.targetRoles.join(", ")} onChange={(e) => setP({ ...p, targetRoles: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} /></div>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 4 }}>Scoring weights</h2>
        <div className="hint" style={{ marginBottom: 10 }}>Normalised automatically. Currently sums to {wsum.toFixed(2)}.</div>
        <div className="row">{(["technical", "evidence", "seniority", "compensation", "product"] as const).map(num)}</div>
        <div className="row">
          <div className="field"><label htmlFor="th-a">&ldquo;Apply&rdquo; threshold</label><input id="th-a" type="number" value={p.thresholds.apply} onChange={(e) => setP({ ...p, thresholds: { ...p.thresholds, apply: Number(e.target.value) } })} /></div>
          <div className="field"><label htmlFor="th-r">&ldquo;Review&rdquo; threshold</label><input id="th-r" type="number" value={p.thresholds.review} onChange={(e) => setP({ ...p, thresholds: { ...p.thresholds, review: Number(e.target.value) } })} /></div>
          <div className="field"><label htmlFor="th-g">Auto-generate CV from score</label><input id="th-g" type="number" value={p.autoGenerateCvMinScore} onChange={(e) => setP({ ...p, autoGenerateCvMinScore: Number(e.target.value) })} /></div>
          <div className="field"><label htmlFor="th-n">Notify from score</label><input id="th-n" type="number" value={p.notifyMinScore} onChange={(e) => setP({ ...p, notifyMinScore: Number(e.target.value) })} /></div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 4 }}>Standing answers</h2>
        <div className="hint" style={{ marginBottom: 10 }}>Used only for the matching application question. Leave blank and you will be asked each time. Nothing here is ever guessed.</div>
        <div className="row">
          {([["salaryExpectation", "Salary expectation"], ["relocation", "Relocation"], ["noticePeriod", "Notice period / start date"], ["workAuthorization", "Work authorisation"], ["sponsorship", "Visa sponsorship"]] as const).map(([k, l]) => (
            <div className="field" key={k}><label htmlFor={`sa-${k}`}>{l}</label><input id={`sa-${k}`} type="text" value={p.standingAnswers[k] ?? ""} onChange={(e) => setP({ ...p, standingAnswers: { ...p.standingAnswers, [k]: e.target.value || undefined } })} /></div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 4 }}>Schedule</h2>
        <div className="row">
          <div className="field"><label htmlFor="s-i">Ingest every (minutes)</label><input id="s-i" type="number" min="15" value={p.schedule.ingestMinutes} onChange={(e) => setP({ ...p, schedule: { ...p.schedule, ingestMinutes: Number(e.target.value) } })} /></div>
          <div className="field"><label htmlFor="s-p">Screen, score and generate every (minutes)</label><input id="s-p" type="number" min="5" value={p.schedule.processMinutes} onChange={(e) => setP({ ...p, schedule: { ...p.schedule, processMinutes: Number(e.target.value) } })} /></div>
          <div className="field"><label htmlFor="s-r">Reconcile every (minutes)</label><input id="s-r" type="number" min="15" value={p.schedule.reconcileMinutes} onChange={(e) => setP({ ...p, schedule: { ...p.schedule, reconcileMinutes: Number(e.target.value) } })} /></div>
          <div className="field"><label htmlFor="s-d">Daily summary hour (UTC)</label><input id="s-d" type="number" min="0" max="23" value={p.schedule.dailySummaryHourUtc} onChange={(e) => setP({ ...p, schedule: { ...p.schedule, dailySummaryHourUtc: Number(e.target.value) } })} /></div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 4 }}>Authorised submission</h2>
        <div className="notice warn" style={{ marginBottom: 12 }}>Automatic submission stays off unless you record a documented basis here (for example an employer-issued API key and the terms that allow it) <b>and</b> the matching credential is configured on the server. Otherwise the app prepares a package and opens the employer&apos;s page for you.</div>
        {providers.map((pr) => {
          const cfg = p.authorizedSubmission[pr] ?? { enabled: false, basis: "" };
          return (
            <div className="row" key={pr} style={{ alignItems: "flex-end", marginBottom: 8 }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center", flex: "0 0 140px", margin: 0 }}><input type="checkbox" checked={cfg.enabled} onChange={(e) => setP({ ...p, authorizedSubmission: { ...p.authorizedSubmission, [pr]: { ...cfg, enabled: e.target.checked } } })} /> {pr}</label>
              <input type="text" aria-label={`${pr} authorisation basis`} placeholder="Basis: who authorised it, key reference, terms" value={cfg.basis} onChange={(e) => setP({ ...p, authorizedSubmission: { ...p.authorizedSubmission, [pr]: { ...cfg, basis: e.target.value } } })} />
            </div>
          );
        })}
      </div>

      <div className="btns" style={{ marginTop: 16 }}><button className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save preferences"}</button></div>
      {msg ? <div role={msg.tone === "bad" ? "alert" : "status"} className={`notice ${msg.tone}`} style={{ marginTop: 10 }}>{msg.text}</div> : null}
    </form>
  );
}

export function AddFactForm({ entries }: { entries: { id: string; label: string }[] }) {
  const router = useRouter();
  const [entryId, setEntryId] = useState(entries[0]?.id ?? "");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setMsg(null);
        try {
          await post("/api/agent/profile", { addFact: { entryId: entryId || null, text, note: note || undefined } }, "PATCH");
          setText("");
          setNote("");
          setMsg({ tone: "ok", text: "Added and marked verified (you are asserting it is true)." });
          router.refresh();
        } catch (er) {
          setMsg({ tone: "bad", text: (er as Error).message });
        }
      }}
    >
      <div className="field"><label htmlFor="af-entry">Belongs to</label><select id="af-entry" value={entryId} onChange={(e) => setEntryId(e.target.value)}>{entries.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></div>
      <div className="field"><label htmlFor="af-text">What you did, in one factual sentence <span className="hint">include a number only if you can evidence it</span></label><textarea id="af-text" rows={3} required minLength={3} maxLength={600} value={text} onChange={(e) => setText(e.target.value)} /></div>
      <div className="field"><label htmlFor="af-note">Where this can be evidenced <span className="hint">optional: repo, document, person</span></label><input id="af-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <button className="btn primary">Add verified fact</button>
      {msg ? <div role={msg.tone === "bad" ? "alert" : "status"} className={`notice ${msg.tone}`} style={{ marginTop: 10 }}>{msg.text}</div> : null}
    </form>
  );
}
