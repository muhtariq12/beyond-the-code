import { Nav } from "@/components/agent/Nav";
import { LogoutButton } from "@/components/agent/client";
import { getCtx } from "@/lib/agent/runtime";

export const dynamic = "force-dynamic";

export default async function AppShell({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  const [apps, matches, notes] = await Promise.all([ctx.store.list("applications"), ctx.store.list("matches"), ctx.store.list("notifications")]);
  const review = apps.filter((a) => a.status === "READY_FOR_REVIEW").length;
  const qualified = matches.filter((m) => m.eligibility !== "INELIGIBLE" && m.recommendation !== "SKIP").length;
  const attention = apps.filter((a) => ["NEEDS_ATTENTION", "SUBMISSION_FAILED"].includes(a.status)).length + notes.filter((n) => !n.read && n.type === "FOLLOW_UP_DUE").length;
  return (
    <>
      <aside className="side">
        <div className="brand">Job Agent<small>Personal, single-user</small></div>
        <Nav
          items={[
            { href: "/agent", label: "Overview" },
            { href: "/agent/discover", label: "Discover Jobs" },
            { href: "/agent/matches", label: "Matched Jobs", count: qualified },
            { href: "/agent/studio", label: "CV Studio", count: review },
            { href: "/agent/applications", label: "Applications" },
            { href: "/agent/followups", label: "Follow-ups", count: attention },
            { href: "/agent/sources", label: "Sources" },
            { href: "/agent/settings", label: "Settings" },
          ]}
        />
        <div className="side-foot">
          <div style={{ marginBottom: 8 }}>LLM: {ctx.llm.available ? ctx.llm.name : "not configured (deterministic mode)"}</div>
          <LogoutButton />
        </div>
      </aside>
      <main className="main">{children}</main>
    </>
  );
}
