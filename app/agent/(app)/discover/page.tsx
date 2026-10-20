import Link from "next/link";
import { JobTable } from "@/components/agent/JobTable";
import { Act, JsonForm } from "@/components/agent/client";
import { Empty, Notice, Page } from "@/components/agent/ui";
import { loadRows } from "@/lib/agent/queries";
import { getCtx } from "@/lib/agent/runtime";

export default async function Discover({ searchParams }: { searchParams: Promise<{ q?: string; source?: string }> }) {
  const { q, source } = await searchParams;
  const ctx = await getCtx();
  const [rows, sources] = await Promise.all([loadRows(ctx), ctx.store.list("sources")]);
  const needle = q?.toLowerCase().trim();
  const list = rows
    .filter((r) => (!source || r.job.sourceType === source) && (!needle || `${r.job.title} ${r.job.employer} ${r.job.location}`.toLowerCase().includes(needle)))
    .sort((a, b) => (b.app?.createdAt ?? "").localeCompare(a.app?.createdAt ?? ""));
  const feeds = sources.filter((s) => s.type !== "manual" && s.type !== "email" && s.type !== "sandbox");

  return (
    <Page
      title="Discover Jobs"
      sub="Jobs from published ATS feeds you add, plus postings and alert emails you paste. Nothing is scraped."
      actions={feeds.length ? <Act url="/api/agent/pipeline" body={{ step: "ingest" }}>Sync all sources</Act> : null}
    >
      <div className="grid g2" style={{ alignItems: "start", marginBottom: 16 }}>
        <div className="card">
          <div className="card-head"><h2>Add a job you found</h2></div>
          <p className="hint" style={{ marginTop: 0 }}>Paste a posting from LinkedIn, a UAE job board or an employer page you are viewing. It is stored as text and screened like any other job.</p>
          <JsonForm
            url="/api/agent/jobs"
            constants={{ kind: "paste" }}
            submit="Add and screen"
            goto="/agent/jobs/{jobId}"
            fields={[
              { name: "title", label: "Job title", required: true },
              { name: "employer", label: "Employer", required: true },
              { name: "url", label: "Original URL", type: "url", required: true, placeholder: "https://…" },
              { name: "location", label: "Location", placeholder: "Dubai, UAE or Remote (Middle East)" },
              { name: "salaryText", label: "Salary, if shown", placeholder: "AED 15,000 – 20,000 per month" },
              { name: "description", label: "Full description", type: "textarea", required: true, rows: 7 },
            ]}
          />
        </div>
        <div className="card">
          <div className="card-head"><h2>Paste a job-alert email</h2></div>
          <p className="hint" style={{ marginTop: 0 }}>Forward or paste a LinkedIn saved-search or job-board alert. Links are extracted by plain parsing (no AI reads the email). Greenhouse, Lever and Ashby links are resolved through their public feeds; others become stubs awaiting a pasted description.</p>
          <JsonForm url="/api/agent/jobs" constants={{ kind: "email" }} submit="Extract jobs" fields={[{ name: "body", label: "Email body", type: "textarea", required: true, rows: 8 }]} />
          {feeds.length === 0 ? <div style={{ marginTop: 12 }}><Notice tone="info">No ATS feeds connected yet. <Link href="/agent/sources">Add a Greenhouse, Lever or Ashby board</Link> to discover jobs automatically.</Notice></div> : null}
        </div>
      </div>

      <form className="inline-form" style={{ marginBottom: 12 }} action="/agent/discover">
        <div style={{ flex: "1 1 260px" }}><label htmlFor="q">Search discovered jobs</label><input id="q" name="q" type="text" defaultValue={q} placeholder="Title, employer or location" /></div>
        <button className="btn">Search</button>
      </form>

      {list.length === 0 ? (
        <Empty title={rows.length ? "No jobs match that search" : "No jobs discovered yet"}>
          {rows.length ? "Clear the search to see everything." : "Add a source or paste a job above. Counts and tables here only ever show jobs that were actually retrieved."}
        </Empty>
      ) : (
        <JobTable rows={list} />
      )}
    </Page>
  );
}
