import { AddFactForm, Act, CvUploadForm, PrefsForm } from "@/components/agent/client";
import { Chip, Empty, Notice, Page, Tabs } from "@/components/agent/ui";
import { authConfig, authDisabled } from "@/lib/agent/auth";
import { profileIssues, isTechFact } from "@/lib/agent/profile/facts";
import { getCtx } from "@/lib/agent/runtime";
import type { Profile } from "@/lib/agent/types";

const TABS = [
  { key: "preferences", label: "Preferences", href: "/agent/settings?tab=preferences" },
  { key: "profile", label: "Profile & facts", href: "/agent/settings?tab=profile" },
  { key: "system", label: "System", href: "/agent/settings?tab=system" },
];

export default async function Settings({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = "preferences" } = await searchParams;
  const ctx = await getCtx();
  const [prefs, profile] = await Promise.all([ctx.store.get("preferences", "prefs"), ctx.store.get("profile", "profile")]);
  return (
    <Page title="Settings" sub="Your rules, your verified profile, and the state of the system.">
      <Tabs current={tab} items={TABS} />

      {tab === "preferences" && prefs ? <PrefsForm prefs={prefs} /> : null}

      {tab === "profile" ? (
        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>{profile ? "CV import" : "Import your CV"}</h2></div>
            <p className="hint" style={{ marginTop: 0 }}>Your uploaded CV is the authoritative source and is stored unchanged. Everything parsed from it starts unverified. Only verified items can appear in a generated CV.</p>
            <CvUploadForm hasProfile={!!profile} />
          </div>
          {!profile ? <Empty title="No profile yet">Upload your CV above to build your fact registry.</Empty> : <ProfileInner profile={profile} now={ctx.now()} />}
        </div>
      ) : null}

      {tab === "system" ? <System ctx={ctx} /> : null}
    </Page>
  );
}

function ProfileInner({ profile, now }: { profile: Profile; now: Date }) {
  const issues = profileIssues(profile, now);
  const unverified = profile.facts.filter((f) => !f.verified).length + profile.entries.filter((e) => !e.verified).length + profile.skills.filter((s) => !s.verified).length;
  const groups = ["EMPLOYMENT", "PROJECT", "EDUCATION", "PUBLICATION", "CERTIFICATION", "AWARD"] as const;
  const summaryFacts = profile.facts.filter((f) => f.entryId === null);
  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>{profile.fullName}</h2>
          {unverified ? <Act variant="primary" method="PATCH" url="/api/agent/profile" body={{ verifyAll: true }} confirm="Confirm that everything imported from your CV is accurate?">Verify all {unverified} item(s)</Act> : <Chip tone="ok">Everything verified</Chip>}
        </div>
        <p className="t-sub" style={{ margin: 0 }}>{[profile.headline, profile.location, profile.email, profile.phone].filter(Boolean).join(" · ")}</p>
        {issues.length ? <ul style={{ margin: "12px 0 0", paddingLeft: 18 }}>{issues.map((i, k) => <li key={k}><Chip tone={i.level === "QUESTION" ? "warn" : "info"}>{i.level === "QUESTION" ? "Please confirm" : "Note"}</Chip> {i.text}</li>)}</ul> : null}
      </div>

      {summaryFacts.length ? (
        <div className="card">
          <h2 style={{ marginBottom: 8 }}>Summary statements</h2>
          <FactList facts={summaryFacts} />
        </div>
      ) : null}

      {groups.map((g) => {
        const es = profile.entries.filter((e) => e.type === g).sort((a, b) => a.order - b.order);
        if (!es.length) return null;
        return (
          <div className="card" key={g}>
            <h2 style={{ marginBottom: 8 }}>{g[0] + g.slice(1).toLowerCase()} ({es.length})</h2>
            {es.map((e) => {
              const fs = profile.facts.filter((f) => f.entryId === e.id);
              return (
                <div key={e.id} style={{ padding: "10px 0", borderTop: "1px solid var(--line)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                    <div><b>{e.title}</b>{e.org ? <span className="t-sub"> · {e.org}</span> : null}<div className="t-sub">{[e.start, e.current ? "present" : e.end].filter(Boolean).join(" → ")} · {e.source.ref}</div></div>
                    {e.verified && fs.every((f) => f.verified) ? <Chip tone="ok">Verified</Chip> : <Act small method="PATCH" url="/api/agent/profile" body={{ verifyEntryIds: [e.id], verifyFactIds: fs.map((f) => f.id) }}>Verify</Act>}
                  </div>
                  <FactList facts={fs} />
                </div>
              );
            })}
          </div>
        );
      })}

      <div className="card">
        <div className="card-head"><h2>Skills ({profile.skills.length})</h2></div>
        <div className="btns">
          {profile.skills.map((s) => s.verified ? <Chip key={s.label} tone="ok">{s.label}</Chip> : <Act key={s.label} small method="PATCH" url="/api/agent/profile" body={{ verifySkills: [s.label] }}>Verify {s.label}</Act>)}
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 8 }}>Add a fact the CV does not show</h2>
        <p className="hint" style={{ marginTop: 0 }}>Use this to answer a question from CV Studio (for example real experience with a tool the CV omits). It is recorded as entered by you, with where it can be evidenced.</p>
        <AddFactForm entries={[{ id: "", label: "General (summary)" }, ...profile.entries.filter((e) => e.type === "EMPLOYMENT" || e.type === "PROJECT").map((e) => ({ id: e.id, label: `${e.type === "PROJECT" ? "Project" : "Role"}: ${e.title}` }))]} />
      </div>
    </>
  );
}

function FactList({ facts }: { facts: Profile["facts"] }) {
  return (
    <ul className="list" style={{ marginTop: 6 }}>
      {facts.map((f) => (
        <li key={f.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", fontSize: 13 }}>
          <div>
            {isTechFact(f) ? <i>{f.text}</i> : f.text}
            <div className="t-sub">{f.skills.length ? `Skills: ${f.skills.join(", ")} · ` : ""}{f.metrics.length ? `Numbers: ${f.metrics.join(", ")} · ` : ""}{f.source.ref}</div>
          </div>
          <div className="btns" style={{ flexShrink: 0 }}>
            {f.verified ? <Act small method="PATCH" url="/api/agent/profile" body={{ unverifyFactIds: [f.id] }}>Unverify</Act> : <Act small method="PATCH" url="/api/agent/profile" body={{ verifyFactIds: [f.id] }}>Verify</Act>}
            <Act small variant="danger" method="PATCH" url="/api/agent/profile" body={{ removeFactId: f.id }} confirm="Remove this fact from your registry?">Remove</Act>
          </div>
        </li>
      ))}
    </ul>
  );
}

function System({ ctx }: { ctx: Awaited<ReturnType<typeof getCtx>> }) {
  const auth = authConfig(process.env);
  const row = (label: string, ok: boolean, on: string, off: string) => (
    <tr><td className="t-title">{label}</td><td><Chip tone={ok ? "ok" : "warn"}>{ok ? on : off}</Chip></td></tr>
  );
  return (
    <div className="stack">
      <div className="tablewrap">
        <table>
          <thead><tr><th>Component</th><th>State</th></tr></thead>
          <tbody>
            {row("Login protection", auth.ok && !authDisabled(process.env), "Password + signed session", authDisabled(process.env) ? "DISABLED (dev only)" : "Not configured")}
            {row("LLM provider", ctx.llm.available, `${ctx.llm.name}`, "None (deterministic tailoring)")}
            {row("Webhook notifications", !!ctx.env.NOTIFY_WEBHOOK_URL, "Configured", "In-app only")}
            {row("Cron secret (external scheduler)", (ctx.env.CRON_SECRET ?? "").length >= 24, "Configured", "Not set")}
            {row("Greenhouse submission credential", !!ctx.env.GREENHOUSE_JOB_BOARD_API_KEY, "Present", "Not set")}
            {row("Storage", true, "Local files (data/, private)", "")}
          </tbody>
        </table>
      </div>
      <Notice tone="info">Storage is a local, permission-restricted file store. The Postgres schema with Row Level Security is in <code>supabase/migrations</code> and is tested, but this build does not yet read or write through Supabase. Secrets are only read from environment variables and are never shown here.</Notice>
    </div>
  );
}
