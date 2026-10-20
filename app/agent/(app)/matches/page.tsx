import Link from "next/link";
import { JobTable } from "@/components/agent/JobTable";
import { Empty, Page, Tabs } from "@/components/agent/ui";
import { isQualified, loadRows } from "@/lib/agent/queries";
import { getCtx } from "@/lib/agent/runtime";

const VIEWS = [
  { key: "qualified", label: "Qualified" },
  { key: "apply", label: "Apply" },
  { key: "review", label: "Needs your input" },
  { key: "rejected", label: "Rejected by rules" },
];

export default async function Matches({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view = "qualified" } = await searchParams;
  const ctx = await getCtx();
  const rows = (await loadRows(ctx)).filter((r) => r.match);
  const by = (r: (typeof rows)[number]) => r.match!;
  const list = rows
    .filter((r) => (view === "apply" ? by(r).recommendation === "APPLY" && by(r).eligibility === "ELIGIBLE" : view === "review" ? by(r).eligibility === "UNCERTAIN" && by(r).recommendation !== "SKIP" : view === "rejected" ? by(r).eligibility === "INELIGIBLE" : isQualified(r.match)))
    .sort((a, b) => (by(b).score ?? 0) - (by(a).score ?? 0));
  return (
    <Page title="Matched Jobs" sub="Stage A applies your hard rules; Stage B scores what survives against your verified experience. Uncertain information is kept separate from confirmed failures.">
      <Tabs current={view} items={VIEWS.map((v) => ({ ...v, href: `/agent/matches?view=${v.key}` }))} />
      {list.length === 0 ? (
        <Empty title="Nothing here yet">
          {rows.length === 0 ? <>No jobs have been screened. <Link href="/agent/discover">Discover jobs</Link> first (and make sure your CV facts are verified in Settings).</> : "No jobs in this view."}
        </Empty>
      ) : (
        <JobTable rows={list} detail />
      )}
    </Page>
  );
}
