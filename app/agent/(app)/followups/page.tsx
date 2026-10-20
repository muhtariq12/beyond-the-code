import Link from "next/link";
import { Act } from "@/components/agent/client";
import { Chip, Empty, Page, StatusChip } from "@/components/agent/ui";
import { ago } from "@/lib/agent/format";
import { loadRows } from "@/lib/agent/queries";
import { getCtx } from "@/lib/agent/runtime";

export default async function Followups() {
  const ctx = await getCtx();
  const rows = await loadRows(ctx);
  const notes = (await ctx.store.list("notifications")).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const now = ctx.now().getTime();
  const sent = rows.filter((r) => r.app && ["SUBMITTED", "INTERVIEW"].includes(r.app.status) && r.app.confirmation);
  const attention = rows.filter((r) => r.app && ["NEEDS_ATTENTION", "SUBMISSION_FAILED", "READY_FOR_REVIEW"].includes(r.app.status));
  const dueAt = (a: NonNullable<(typeof rows)[number]["app"]>) => (a.followUpAt ? Date.parse(a.followUpAt) : Date.parse(a.confirmation!.at) + 7 * 86400_000);
  return (
    <Page title="Follow-ups" sub="Submitted applications are due for a follow-up a week after confirmation unless you set a date. Outcomes (interviews, rejections, offers) are recorded by you; this app does not read your inbox.">
      <div className="stack">
        <div className="card">
          <div className="card-head"><h2>Waiting on you</h2></div>
          {attention.length === 0 ? <p style={{ margin: 0, color: "var(--muted)" }}>Nothing waiting.</p> : (
            <ul className="list">{attention.map((r) => <li key={r.job.id} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><div><Link className="t-title" href={r.app!.status === "READY_FOR_REVIEW" ? `/agent/studio/${r.job.id}` : `/agent/applications/${r.app!.id}`}>{r.job.title}</Link><div className="t-sub">{r.job.employer}</div></div><StatusChip status={r.app!.status} /></li>)}</ul>
          )}
        </div>
        <div className="card">
          <div className="card-head"><h2>Submitted applications</h2></div>
          {sent.length === 0 ? <Empty title="No submitted applications yet">Once you submit (or attest that you applied), follow-up dates show here.</Empty> : (
            <div className="tablewrap" style={{ border: 0 }}>
              <table>
                <thead><tr><th>Role</th><th>Status</th><th>Submitted</th><th>Follow up</th><th>Record outcome</th></tr></thead>
                <tbody>
                  {sent.map((r) => {
                    const due = dueAt(r.app!);
                    return (
                      <tr key={r.app!.id}>
                        <td><Link className="t-title" href={`/agent/applications/${r.app!.id}`}>{r.job.title}</Link><div className="t-sub">{r.job.employer}</div></td>
                        <td><StatusChip status={r.app!.status} /></td>
                        <td className="t-sub">{ago(r.app!.confirmation!.at, ctx.now())}</td>
                        <td>{due <= now ? <Chip tone="warn">Due now</Chip> : <span className="t-sub">{new Date(due).toISOString().slice(0, 10)}</span>}</td>
                        <td><div className="btns"><Act small url="/api/agent/applications" body={{ action: "status", id: r.app!.id, to: "INTERVIEW" }}>Interview</Act><Act small url="/api/agent/applications" body={{ action: "status", id: r.app!.id, to: "REJECTED" }}>Rejected</Act><Act small url="/api/agent/applications" body={{ action: "status", id: r.app!.id, to: "OFFER" }}>Offer</Act></div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-head"><h2>Notifications</h2>{notes.some((n) => !n.read) ? <Act small url="/api/agent/notifications" body={{ all: true }}>Mark all read</Act> : null}</div>
          {notes.length === 0 ? <p style={{ margin: 0, color: "var(--muted)" }}>No notifications.</p> : (
            <ul className="list">{notes.slice(0, 30).map((n) => <li key={n.id} style={{ opacity: n.read ? 0.6 : 1 }}><div style={{ display: "flex", gap: 8, alignItems: "center" }}><Chip>{n.type.replace(/_/g, " ").toLowerCase()}</Chip><b>{n.title}</b></div><div className="t-sub">{n.body} · {ago(n.createdAt, ctx.now())}{n.deliveredWebhook ? " · sent to webhook" : ""}</div></li>)}</ul>
          )}
        </div>
      </div>
    </Page>
  );
}
