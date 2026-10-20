import Link from "next/link";
import { Chip, Empty, Page, Score, StatusChip, Tabs } from "@/components/agent/ui";
import { ago } from "@/lib/agent/format";
import { loadRows } from "@/lib/agent/queries";
import { getCtx } from "@/lib/agent/runtime";
import { APPLICATION_STATUSES } from "@/lib/agent/types";

export default async function Applications({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status = "active" } = await searchParams;
  const ctx = await getCtx();
  const rows = (await loadRows(ctx)).filter((r) => r.app);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.app!.status, (counts.get(r.app!.status) ?? 0) + 1);
  const active = new Set(["CV_GENERATED", "READY_FOR_REVIEW", "APPROVED", "SUBMISSION_PENDING", "SUBMISSION_FAILED", "NEEDS_ATTENTION", "SUBMITTED", "INTERVIEW", "OFFER"]);
  const list = rows.filter((r) => (status === "active" ? active.has(r.app!.status) : status === "all" ? true : r.app!.status === status)).sort((a, b) => b.app!.updatedAt.localeCompare(a.app!.updatedAt));
  const tabs = [{ key: "active", label: "In progress" }, { key: "all", label: `All (${rows.length})` }, ...APPLICATION_STATUSES.filter((s) => counts.get(s)).map((s) => ({ key: s, label: `${s.replace(/_/g, " ").toLowerCase()} (${counts.get(s)})` }))];
  return (
    <Page title="Applications" sub="Every status change is recorded. SUBMITTED is only set after a provider confirmation or after you attest that you applied yourself.">
      <Tabs current={status} items={tabs.map((t) => ({ ...t, href: `/agent/applications?status=${t.key}` }))} />
      {list.length === 0 ? (
        <Empty title="No applications here">Applications appear once a job is qualified and a tailored CV is prepared. <Link href="/agent/matches">See matched jobs</Link>.</Empty>
      ) : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Role</th><th>Match</th><th>Status</th><th>Route</th><th>Confirmation</th><th>Updated</th><th /></tr></thead>
            <tbody>
              {list.map(({ job, match, app }) => (
                <tr key={app!.id}>
                  <td><Link className="t-title" href={`/agent/applications/${app!.id}`}>{job.title}</Link><div className="t-sub">{job.employer}</div></td>
                  <td><Score value={match?.score} ineligible={match?.eligibility === "INELIGIBLE"} /></td>
                  <td><StatusChip status={app!.status} /></td>
                  <td><Chip>{app!.provider}</Chip></td>
                  <td>{app!.confirmation ? <Chip tone={app!.confirmation.kind === "PROVIDER" ? "ok" : "info"}>{app!.confirmation.kind === "PROVIDER" ? "Provider confirmed" : "Self-reported"}</Chip> : <span className="t-sub">none</span>}</td>
                  <td className="t-sub">{ago(app!.updatedAt, ctx.now())}</td>
                  <td><Link className="btn sm" href={`/agent/applications/${app!.id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
