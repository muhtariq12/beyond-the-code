import Link from "next/link";
import { Chip, Score, StatusChip } from "./ui";
import { remoteLabel, salaryLabel } from "@/lib/agent/format";
import type { Row } from "@/lib/agent/queries";

const REC_TONE = { APPLY: "ok", REVIEW: "warn", SKIP: "" } as const;

export function JobTable({ rows, detail = false }: { rows: Row[]; detail?: boolean }) {
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th>Role</th>
            <th>Location</th>
            <th>Salary</th>
            <th>Match</th>
            {detail ? <th>Evidence &amp; gaps</th> : null}
            <th>CV</th>
            <th>Application</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ job, match, app, cv }) => {
            const sal = salaryLabel(job, match);
            const inel = match?.eligibility === "INELIGIBLE";
            const demonstrated = match?.matched.filter((m) => m.strength === "DEMONSTRATED").map((m) => m.requirement).slice(0, 4) ?? [];
            const gaps = match?.gaps.filter((g) => g.kind === "MISSING").map((g) => g.requirement).slice(0, 3) ?? [];
            const failed = match?.checks.filter((c) => c.result === "FAIL").map((c) => c.label) ?? [];
            return (
              <tr key={job.id}>
                <td style={{ minWidth: 220 }}>
                  <Link className="t-title" href={`/agent/jobs/${job.id}`}>{job.title}</Link>
                  <div className="t-sub">{job.employer} · {job.sourceType} · <a href={job.url} target="_blank" rel="noopener noreferrer nofollow" aria-label={`Open original posting for ${job.title}`}>Original ↗</a></div>
                  {job.injectionSignals.length ? <Chip tone="bad" title={job.injectionSignals.join(", ")}>Suspicious text</Chip> : null}
                </td>
                <td style={{ minWidth: 150 }}>
                  <div>{job.location || "–"}</div>
                  <div className="t-sub">{remoteLabel(job)}{match ? ` · ${match.geoEligibility.toLowerCase().replace("_", " ")}` : ""}</div>
                </td>
                <td style={{ minWidth: 140 }}>
                  <div className="num">{sal.text}</div>
                  <div className="t-sub">{sal.sub}</div>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <Score value={match?.score} ineligible={inel} />{" "}
                  {match ? <Chip tone={inel ? "bad" : REC_TONE[match.recommendation]}>{inel ? "Ineligible" : match.eligibility === "UNCERTAIN" ? "Uncertain" : match.recommendation === "APPLY" ? "Apply" : match.recommendation === "REVIEW" ? "Review" : "Skip"}</Chip> : null}
                </td>
                {detail ? (
                  <td style={{ minWidth: 240, fontSize: 12.5 }}>
                    {inel ? <span style={{ color: "var(--bad)" }}>Failed: {failed.join(", ")}</span> : null}
                    {demonstrated.length ? <div><b>Shown:</b> {demonstrated.join(", ")}</div> : null}
                    {gaps.length ? <div style={{ color: "var(--muted)" }}><b>Missing:</b> {gaps.join(", ")}</div> : null}
                  </td>
                ) : null}
                <td>{cv ? <Link href={`/agent/studio/${job.id}`}><Chip tone={cv.status === "APPROVED" ? "ok" : cv.validation.pass ? "info" : "bad"}>v{cv.version} {cv.status.toLowerCase()}</Chip></Link> : <span className="t-sub">{inel ? "not generated" : "none yet"}</span>}</td>
                <td>{app ? <StatusChip status={app.status} /> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
