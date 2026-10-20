import Link from "next/link";
import { notFound } from "next/navigation";
import { Act } from "@/components/agent/client";
import { Bar, Checks, Chip, Notice, Page, Score, StatusChip } from "@/components/agent/ui";
import { remoteLabel, salaryLabel } from "@/lib/agent/format";
import { loadRows } from "@/lib/agent/queries";
import { getCtx } from "@/lib/agent/runtime";

const LABELS: Record<string, string> = { technical: "Technical & skills match (35%)", evidence: "Evidence-backed experience (25%)", seniority: "Seniority & responsibility fit (15%)", compensation: "Compensation fit (15%)", product: "Career & product fit (10%)" };

export default async function JobDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  const row = (await loadRows(ctx)).find((r) => r.job.id === id);
  if (!row) notFound();
  const { job, match, app, cv } = row;
  const prefs = await ctx.store.get("preferences", "prefs");
  const sal = salaryLabel(job, match);
  const canPrepare = match && match.eligibility !== "INELIGIBLE" && !job.descriptionMissing;

  return (
    <Page
      title={job.title}
      sub={<>{job.employer} · {job.location || "Location n/s"} · {remoteLabel(job)}</>}
      actions={
        <>
          <a className="btn" href={job.url} target="_blank" rel="noopener noreferrer nofollow">Open original ↗</a>
          {cv ? <Link className="btn primary" href={`/agent/studio/${job.id}`}>Open CV Studio</Link> : canPrepare ? <Act variant="primary" url="/api/agent/cv" body={{ action: "prepare", jobId: job.id }} goto={`/agent/studio/${job.id}`}>Prepare tailored CV</Act> : null}
        </>
      }
    >
      <div className="stack">
        {job.injectionSignals.length ? <Notice tone="bad"><b>This posting contains text that tries to instruct an AI</b> ({job.injectionSignals.join(", ")}). It is treated purely as data: it cannot change scoring, CV content or any action. Read it with care.</Notice> : null}
        {job.descriptionMissing ? <Notice tone="warn">This job has no description yet (alert stub). Paste the full text in Discover Jobs so it can be screened.</Notice> : null}
        {!match ? <Notice tone="info">Not screened yet. Run the pipeline from Overview.</Notice> : null}

        {match ? (
          <div className="card">
            <div className="card-head"><h2>Assessment</h2><div style={{ display: "flex", gap: 8, alignItems: "center" }}><Score value={match.score} ineligible={match.eligibility === "INELIGIBLE"} />{app ? <StatusChip status={app.status} /> : null}</div></div>
            <p style={{ marginTop: 0 }}>{match.explanation}</p>
            <dl className="kv">
              <dt>Salary</dt><dd>{sal.text} <span className="t-sub">({sal.sub})</span>{job.salary ? <div className="t-sub">Published as: &ldquo;{job.salary.raw}&rdquo;</div> : null}</dd>
              <dt>Geography</dt><dd>{match.geoEligibility.toLowerCase().replace("_", " ")}</dd>
              <dt>Employment</dt><dd>{job.employmentType.replace("_", " ").toLowerCase()}</dd>
              <dt>Experience asked</dt><dd>{job.experienceYearsMin ? `${job.experienceYearsMin}+ years` : "not stated"}</dd>
              <dt>Posted</dt><dd>{job.postedAt?.slice(0, 10) ?? "n/a"} · retrieved {job.retrievedAt.slice(0, 10)} · {job.availability.toLowerCase()}</dd>
              <dt>Source</dt><dd>{job.sourceType}{job.alsoSeen.length ? ` · also seen on ${job.alsoSeen.length} other source(s)` : ""}</dd>
            </dl>
          </div>
        ) : null}

        {match ? (
          <div>
            <h2 style={{ margin: "4px 0 8px" }}>Stage A: hard eligibility</h2>
            <Checks checks={match.checks} />
          </div>
        ) : null}

        {match && match.eligibility !== "INELIGIBLE" ? (
          <div className="grid g2" style={{ alignItems: "start" }}>
            <div className="card">
              <h2 style={{ marginBottom: 10 }}>Stage B: score breakdown</h2>
              {Object.entries(match.breakdown).map(([k, v]) => (
                <div key={k} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span>{LABELS[k] ?? k}</span><span className="num">{v}</span></div>
                  <Bar value={v} />
                </div>
              ))}
              <div className="hint">Weights are configurable in Settings{prefs ? "" : ""}. A skill that only appears in a skills list earns far less than one demonstrated in work.</div>
              {match.cvEmphasis.length ? <p style={{ marginBottom: 0 }}><b>Recommended CV emphasis:</b> {match.cvEmphasis.join(", ")}</p> : null}
            </div>
            <div className="card">
              <h2 style={{ marginBottom: 10 }}>Requirements and evidence</h2>
              {match.matched.length === 0 && match.gaps.length === 0 ? <p style={{ margin: 0, color: "var(--muted)" }}>No required skills could be extracted from this posting.</p> : null}
              <ul className="list">
                {match.matched.map((m) => (
                  <li key={m.requirement}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}><b>{m.requirement}</b><Chip tone={m.strength === "DEMONSTRATED" ? "ok" : m.strength === "PROJECT_ONLY" ? "info" : "warn"}>{m.strength === "DEMONSTRATED" ? "Shown in work" : m.strength === "PROJECT_ONLY" ? "Shown in a project" : "Listed only"}</Chip></div>
                    {m.evidence[0] ? <div className="t-sub">&ldquo;{m.evidence[0]}&rdquo;</div> : <div className="t-sub">Appears in your skills list but nothing verified shows it in use.</div>}
                  </li>
                ))}
                {match.gaps.filter((g) => g.kind === "MISSING").map((g) => (
                  <li key={g.requirement}><b>{g.requirement}</b> <Chip tone="bad">No verified evidence</Chip></li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        <div className="card">
          <h2 style={{ marginBottom: 10 }}>Job description</h2>
          <div className="jd">{job.description || "(empty)"}</div>
          <div className="hint" style={{ marginTop: 6 }}>Shown as plain text. Retrieved {job.retrievedAt.slice(0, 16).replace("T", " ")} UTC.</div>
        </div>
      </div>
    </Page>
  );
}
