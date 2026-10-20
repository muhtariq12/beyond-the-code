import Link from "next/link";
import { notFound } from "next/navigation";
import { Act, AnswerInput, CopyButton } from "@/components/agent/client";
import { QuestionsClient } from "@/components/agent/QuestionsClient";
import { Chip, Notice, Page, Score, StatusChip } from "@/components/agent/ui";
import { resolveCapability } from "@/lib/agent/apply/capabilities";
import { TRANSITIONS } from "@/lib/agent/apply/status";
import { buildHandoff, preflight } from "@/lib/agent/apply/submit";
import { getCtx } from "@/lib/agent/runtime";

export default async function ApplicationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  const app = await ctx.store.get("applications", id);
  if (!app) notFound();
  const [job, match, prefs, answers, events, attempts, cvs, letter] = await Promise.all([
    ctx.store.get("jobs", app.jobId), ctx.store.get("matches", `m_${app.jobId}`), ctx.store.get("preferences", "prefs"),
    ctx.store.list("answers"), ctx.store.list("events"), ctx.store.list("attempts"), ctx.store.list("cvVersions"),
    app.coverLetterId ? ctx.store.get("coverLetters", app.coverLetterId) : Promise.resolve(null),
  ]);
  if (!job || !prefs) notFound();
  const cap = resolveCapability(app.provider, prefs, ctx.env, ctx.adapters);
  const myAnswers = answers.filter((a) => a.applicationId === id);
  const myEvents = events.filter((e) => e.applicationId === id).sort((a, b) => a.at.localeCompare(b.at));
  const myAttempts = attempts.filter((a) => a.applicationId === id).sort((a, b) => a.attemptNo - b.attemptNo);
  const cv = cvs.find((c) => c.id === app.cvVersionId);
  const approvedCv = cvs.filter((c) => c.jobId === app.jobId && c.status === "APPROVED").sort((a, b) => b.version - a.version)[0];
  const pf = cap.state === "AUTHORIZED_API_SUBMISSION" ? await preflight(ctx, id) : null;
  const handoff = await buildHandoff(ctx, id);
  const needs = myAnswers.filter((a) => a.status !== "ANSWERED");
  const next = TRANSITIONS[app.status].filter((s) => ["INTERVIEW", "REJECTED", "OFFER", "WITHDRAWN"].includes(s));

  return (
    <Page
      title={job.title}
      sub={<>{job.employer} · {job.location}</>}
      actions={<><StatusChip status={app.status} /><a className="btn" href={handoff.openUrl} target="_blank" rel="noopener noreferrer nofollow">Open original page ↗</a></>}
    >
      <div className="stack">
        <div className="grid g2" style={{ alignItems: "start" }}>
          <div className="card">
            <h2 style={{ marginBottom: 10 }}>Route</h2>
            <p style={{ margin: "0 0 8px" }}><Chip tone={cap.state === "AUTHORIZED_API_SUBMISSION" ? "accent" : cap.state === "DISABLED" ? "bad" : ""}>{cap.state.replace(/_/g, " ").toLowerCase()}</Chip></p>
            <p className="hint" style={{ margin: 0 }}>{cap.reason}</p>
            <dl className="kv" style={{ marginTop: 12 }}>
              <dt>Match</dt><dd><Score value={match?.score} /> <span className="t-sub">{match?.recommendation.toLowerCase()}</span></dd>
              <dt>CV</dt><dd>{cv ? <Link href={`/agent/studio/${job.id}?v=${cv.id}`}>v{cv.version} ({cv.status.toLowerCase()})</Link> : "none"}</dd>
              <dt>Confirmation</dt><dd>{app.confirmation ? <>{app.confirmation.kind === "PROVIDER" ? "Provider confirmed" : "Self-reported"} · {app.confirmation.reference ?? "no reference"} · {app.confirmation.at.slice(0, 16).replace("T", " ")}</> : "None. Not submitted."}</dd>
            </dl>
          </div>

          <div className="card">
            <h2 style={{ marginBottom: 10 }}>Next step</h2>
            {app.status === "READY_FOR_REVIEW" || app.status === "CV_GENERATED" ? (
              <>
                <p style={{ marginTop: 0 }}>Review and approve the tailored CV, then approve the application.</p>
                <div className="btns">
                  <Link className="btn primary" href={`/agent/studio/${job.id}`}>Review CV</Link>
                  {approvedCv ? <Act url="/api/agent/applications" body={{ action: "approve", id, cvVersionId: approvedCv.id }}>Approve application with CV v{approvedCv.version}</Act> : null}
                </div>
              </>
            ) : null}
            {app.status === "APPROVED" || app.status === "SUBMISSION_FAILED" ? (
              <>
                {needs.length ? <Notice tone="warn">{needs.length} mandatory answer(s) need you first.</Notice> : null}
                <div className="btns" style={{ marginTop: needs.length ? 10 : 0 }}>
                  {cap.state === "AUTHORIZED_API_SUBMISSION" ? <Act variant="primary" url="/api/agent/applications" body={{ action: "submit", id }} confirm="Submit this application to the employer now?">Submit via authorised integration</Act> : null}
                  <Act url="/api/agent/applications" body={{ action: "attest", id, reference: null }} confirm="Confirm that you submitted this application yourself on the employer's page?">I applied myself: mark submitted</Act>
                </div>
                {cap.state !== "AUTHORIZED_API_SUBMISSION" ? <p className="hint">Automatic submission is not authorised for this provider. Use the hand-off package below, apply on the employer&apos;s page, then mark it submitted.</p> : null}
              </>
            ) : null}
            {app.status === "NEEDS_ATTENTION" ? <Notice tone="bad">Needs you. {myEvents.at(-1)?.detail}</Notice> : null}
            {["SUBMITTED", "INTERVIEW", "OFFER"].includes(app.status) ? <p style={{ marginTop: 0 }}>Record what happens next so the dashboard stays truthful.</p> : null}
            {next.length ? <div className="btns" style={{ marginTop: 10 }}>{next.map((s) => <Act key={s} small url="/api/agent/applications" body={{ action: "status", id, to: s }}>{({ INTERVIEW: "Interview invited", REJECTED: "Rejected", OFFER: "Offer received", WITHDRAWN: "Withdraw" } as Record<string, string>)[s]}</Act>)}</div> : null}
            {["DISCOVERED", "SCREENED", "QUALIFIED"].includes(app.status) ? <p style={{ marginTop: 0 }}>Not prepared yet. <Link href={`/agent/jobs/${job.id}`}>Open the job</Link> to prepare a tailored CV.</p> : null}
          </div>
        </div>

        {pf ? (
          <div className="card">
            <h2 style={{ marginBottom: 10 }}>Pre-submission checks</h2>
            <ul className="list">{pf.checks.map((c) => <li key={c.id}><Chip tone={c.ok ? "ok" : "bad"}>{c.ok ? "OK" : "Blocked"}</Chip> <b>{c.id}</b> <span className="t-sub">{c.detail}</span></li>)}</ul>
          </div>
        ) : null}

        <div className="card">
          <div className="card-head"><h2>Application answers</h2><span className="t-sub">{myAnswers.filter((a) => a.status === "ANSWERED").length}/{myAnswers.length} answered</span></div>
          <p className="hint" style={{ marginTop: 0 }}>Sensitive questions (work authorisation, sponsorship, clearance, salary, relocation, notice, legal declarations, demographics) are never guessed. Contact details and skill experience come only from verified facts.</p>
          {myAnswers.length === 0 ? <p style={{ color: "var(--muted)" }}>No answers prepared yet.</p> : (
            <div className="tablewrap" style={{ border: 0 }}>
              <table>
                <thead><tr><th>Question</th><th>Answer</th><th>Source</th></tr></thead>
                <tbody>
                  {myAnswers.map((a) => (
                    <tr key={a.id}>
                      <td style={{ width: "34%" }}>{a.question}<div><Chip tone={a.category === "FREE_TEXT" || a.category === "CONTACT" || a.category === "LINK" ? "" : "warn"}>{a.category.replace(/_/g, " ").toLowerCase()}</Chip></div></td>
                      <td><AnswerInput answerId={a.id} initial={a.answer ?? ""} draft={a.draft} /></td>
                      <td className="t-sub">{a.status === "ANSWERED" ? a.source.toLowerCase() : "needs you"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ marginTop: 14 }}>
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>Paste the employer&apos;s own questions</summary>
              <p className="hint" style={{ marginTop: 10 }}>One question per line:</p>
              <QuestionsClient id={id} />
            </details>
          </div>
        </div>

        <div className="grid g2" style={{ alignItems: "start" }}>
          <div className="card">
            <div className="card-head"><h2>Hand-off package</h2></div>
            <ol style={{ paddingLeft: 18, margin: "0 0 10px" }}>{handoff.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            <div className="btns">
              {handoff.cvPdfDocId ? <a className="btn sm" href={`/api/agent/documents/${handoff.cvPdfDocId}`}>CV (PDF)</a> : null}
              {handoff.cvDocxDocId ? <a className="btn sm" href={`/api/agent/documents/${handoff.cvDocxDocId}`}>CV (DOCX)</a> : null}
              {letter?.pdfDocId ? <a className="btn sm" href={`/api/agent/documents/${letter.pdfDocId}`}>Cover letter (PDF)</a> : null}
              {handoff.coverLetterText ? <CopyButton text={handoff.coverLetterText} label="Copy cover letter" /> : null}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2>History</h2></div>
            <ul className="list" style={{ maxHeight: 280, overflow: "auto" }}>
              {myEvents.map((e) => <li key={e.id}><span className="t-sub">{e.at.slice(0, 16).replace("T", " ")} · {e.actor.toLowerCase()}</span><div>{e.to ? <>{e.from} → <b>{e.to}</b></> : e.type}{e.detail ? <span className="t-sub"> · {e.detail}</span> : null}</div></li>)}
            </ul>
            {myAttempts.length ? (
              <>
                <h3 style={{ margin: "12px 0 6px" }}>Submission attempts</h3>
                <ul className="list">{myAttempts.map((a) => <li key={a.id}>#{a.attemptNo} <Chip tone={a.outcome === "SUCCEEDED" ? "ok" : a.outcome === "FAILED" ? "bad" : "warn"}>{a.outcome.toLowerCase()}</Chip> <span className="t-sub">{a.providerReference ?? a.error ?? ""}</span></li>)}</ul>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Page>
  );
}

