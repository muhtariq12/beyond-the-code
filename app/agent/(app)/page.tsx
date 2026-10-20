import Link from "next/link";
import { Chip, Empty, Metric, Notice, Page, Score, StatusChip } from "@/components/agent/ui";
import { Act } from "@/components/agent/client";
import { ago } from "@/lib/agent/format";
import { overview } from "@/lib/agent/queries";
import { getCtx } from "@/lib/agent/runtime";
import { resolveCapability } from "@/lib/agent/apply/capabilities";

export default async function Overview() {
  const ctx = await getCtx();
  const [profile, prefs, sources, notes] = await Promise.all([ctx.store.get("profile", "profile"), ctx.store.get("preferences", "prefs"), ctx.store.list("sources"), ctx.store.list("notifications")]);
  const o = await overview(ctx);
  const verified = profile ? profile.facts.filter((f) => f.verified).length : 0;
  const attention = o.rows.filter((r) => r.app && ["NEEDS_ATTENTION", "SUBMISSION_FAILED", "READY_FOR_REVIEW"].includes(r.app.status));
  const connected = sources.filter((s) => s.type !== "manual" && s.type !== "email");
  const sub = "Counts reflect only what this app has actually recorded.";

  return (
    <Page
      title="Overview"
      sub={sub}
      actions={profile ? <Act url="/api/agent/pipeline" body={{ step: "all" }}>Run pipeline now</Act> : null}
    >
      {!profile ? (
        <Empty title="Start by importing your CV" action={<Link className="btn primary" href="/agent/settings?tab=profile">Import CV</Link>}>
          Your CV is the only source of truth for employment, education, skills and metrics. Nothing is invented; every claim in a generated CV traces back to something you verify.
        </Empty>
      ) : verified === 0 ? (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="warn">Your CV is imported but nothing is verified yet, so no CVs can be generated. <Link href="/agent/settings?tab=profile">Review and verify your facts</Link>.</Notice>
        </div>
      ) : null}

      <div className="grid g4">
        <Metric n={o.discovered} label="Newly discovered jobs" sub={`last 7 days · ${o.discoveredTotal} total`} />
        <Metric n={o.qualified} label="Qualified matches" sub={`${o.eligibleConfirmed} fully eligible, rest need your input`} />
        <Metric n={o.cvs} label="CVs generated" sub="one tailored CV per job" />
        <Metric n={o.prepared} label="Applications prepared" sub={`${o.awaitingReview} awaiting your review`} />
        <Metric n={o.submitted} label="Confirmed submissions" sub={`${o.submittedProvider} by provider · ${o.submittedSelf} self-reported`} />
        <Metric n={o.attention} label="Need attention" sub="failed or unconfirmed" />
        <Metric n={o.interviews} label="Interviews" sub="recorded by you" />
        <Metric n={`${o.rejections} / ${o.offers}`} label="Rejections / offers" sub="recorded by you" />
      </div>

      <div className="grid g2" style={{ marginTop: 16, alignItems: "start" }}>
        <div className="card">
          <div className="card-head"><h2>Needs you</h2><Link href="/agent/applications">All applications</Link></div>
          {attention.length === 0 ? (
            <p style={{ color: "var(--muted)", margin: 0 }}>Nothing is waiting on you.</p>
          ) : (
            <ul className="list">
              {attention.slice(0, 8).map((r) => (
                <li key={r.job.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <div>
                    <Link className="t-title" href={r.app!.status === "READY_FOR_REVIEW" ? `/agent/studio/${r.job.id}` : `/agent/applications/${r.app!.id}`}>{r.job.title}</Link>
                    <div className="t-sub">{r.job.employer}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}><Score value={r.match?.score} /><StatusChip status={r.app!.status} /></div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <div className="card-head"><h2>Integrations</h2><Link href="/agent/sources">Manage</Link></div>
          <dl className="kv">
            <dt>Job sources</dt><dd>{connected.length ? `${connected.length} connected (${connected.filter((s) => s.lastError).length} with errors)` : <Chip>None connected yet</Chip>}</dd>
            <dt>LLM provider</dt><dd>{ctx.llm.available ? <Chip tone="ok">{ctx.llm.name}</Chip> : <Chip tone="warn">Not configured</Chip>} <span className="t-sub">{ctx.llm.available ? "rewrites are validated against your facts" : "tailoring is deterministic selection"}</span></dd>
            <dt>Submission</dt><dd>{prefs ? (["greenhouse", "lever", "ashby"].map((p) => resolveCapability(p, prefs, ctx.env, ctx.adapters).state).some((s) => s === "AUTHORIZED_API_SUBMISSION") ? <Chip tone="accent">Authorised for some providers</Chip> : <Chip>Prepare &amp; hand-off only</Chip>) : null}</dd>
            <dt>Webhook alerts</dt><dd>{ctx.env.NOTIFY_WEBHOOK_URL ? <Chip tone="ok">Configured</Chip> : <Chip>In-app only</Chip>}</dd>
          </dl>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><h2>Recent notifications</h2></div>
        {notes.length === 0 ? <p style={{ color: "var(--muted)", margin: 0 }}>No notifications yet.</p> : (
          <ul className="list">
            {notes.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6).map((n) => (
              <li key={n.id}><div className="t-title">{n.title}</div><div className="t-sub">{n.body} · {ago(n.createdAt, ctx.now())}</div></li>
            ))}
          </ul>
        )}
      </div>
    </Page>
  );
}
