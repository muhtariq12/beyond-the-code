import Link from "next/link";
import { Chip, Empty, Page, Score } from "@/components/agent/ui";
import { ago } from "@/lib/agent/format";
import { loadRows } from "@/lib/agent/queries";
import { getCtx } from "@/lib/agent/runtime";

export default async function Studio() {
  const ctx = await getCtx();
  const rows = (await loadRows(ctx)).filter((r) => r.cv);
  const order = { DRAFT: 0, APPROVED: 1, REJECTED: 2, SUPERSEDED: 3 };
  rows.sort((a, b) => order[a.cv!.status] - order[b.cv!.status] || b.cv!.createdAt.localeCompare(a.cv!.createdAt));
  const pending = rows.filter((r) => r.cv!.status === "DRAFT").length;
  return (
    <Page title="CV Studio" sub="One tailored CV per job. Inspect it against your original, edit, approve, regenerate, and download. Approved versions are never changed; every change is a new version.">
      {rows.length === 0 ? (
        <Empty title="No CVs generated yet">CVs are generated for qualified jobs once your profile facts are verified. Open a matched job and choose &ldquo;Prepare tailored CV&rdquo;, or run the pipeline from Overview.</Empty>
      ) : (
        <>
          {pending ? <p style={{ marginTop: 0 }}><Chip tone="warn">{pending} awaiting your review</Chip></p> : null}
          <div className="tablewrap">
            <table>
              <thead><tr><th>Role</th><th>Match</th><th>Latest version</th><th>Claims</th><th>ATS</th><th>Generated</th><th /></tr></thead>
              <tbody>
                {rows.map(({ job, match, cv, cvCount }) => {
                  const ats = cv!.ats.filter((a) => a.status !== "PASS").length;
                  return (
                    <tr key={job.id}>
                      <td><Link className="t-title" href={`/agent/studio/${job.id}`}>{job.title}</Link><div className="t-sub">{job.employer}</div></td>
                      <td><Score value={match?.score} /></td>
                      <td><Chip tone={cv!.status === "APPROVED" ? "ok" : cv!.status === "DRAFT" ? "warn" : ""}>v{cv!.version} {cv!.status.toLowerCase()}</Chip> <span className="t-sub">{cvCount} version(s)</span></td>
                      <td>{cv!.validation.pass ? <Chip tone="ok">All verified</Chip> : <Chip tone="bad">{cv!.validation.violations.length} unsupported</Chip>}</td>
                      <td>{ats === 0 ? <Chip tone="ok">Pass</Chip> : <Chip tone="warn">{ats} to check</Chip>}</td>
                      <td className="t-sub">{ago(cv!.createdAt, ctx.now())}</td>
                      <td><Link className="btn sm" href={`/agent/studio/${job.id}`}>Open</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Page>
  );
}
