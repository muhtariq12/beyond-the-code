import { Act, JsonForm } from "@/components/agent/client";
import { Chip, Notice, Page } from "@/components/agent/ui";
import { connectorInfos, CONNECTORS, UNCONNECTED_PROVIDERS } from "@/lib/agent/connectors/registry";
import { ago } from "@/lib/agent/format";
import { getCtx } from "@/lib/agent/runtime";

export default async function Sources() {
  const ctx = await getCtx();
  const sources = (await ctx.store.list("sources")).filter((s) => s.type !== "sandbox");
  const jobs = await ctx.store.list("jobs");
  const infos = connectorInfos();
  return (
    <Page title="Sources" sub="Every connector reports how it retrieves jobs, when it last succeeded, its error state and what it is permitted to do. A source only appears connected if it actually is.">
      <div className="stack">
        <div className="tablewrap">
          <table>
            <thead><tr><th>Source</th><th>Retrieval method</th><th>Last successful sync</th><th>Status</th><th>Permissions</th><th /></tr></thead>
            <tbody>
              {sources.length === 0 ? <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 28 }}>No sources yet. Add a company&apos;s published job board below.</td></tr> : null}
              {sources.map((s) => {
                const info = CONNECTORS[s.type].info;
                const count = jobs.filter((j) => j.sourceId === s.id).length;
                const feed = info.needsToken;
                return (
                  <tr key={s.id}>
                    <td><div className="t-title">{s.name}</div><div className="t-sub">{info.label}{s.token ? ` · ${s.token}` : ""} · {count} job(s)</div></td>
                    <td style={{ maxWidth: 260 }}>{info.retrievalMethod}</td>
                    <td>{s.lastSuccessAt ? <>{ago(s.lastSuccessAt, ctx.now())}<div className="t-sub">{s.lastJobCount ?? 0} listing(s)</div></> : <span className="t-sub">never</span>}</td>
                    <td>
                      {!s.enabled ? <Chip>Disabled</Chip> : s.lastError ? <Chip tone="bad" title={s.lastError}>Error</Chip> : s.lastSuccessAt ? <Chip tone="ok">Healthy</Chip> : feed ? <Chip tone="warn">Not synced yet</Chip> : <Chip tone="info">On demand</Chip>}
                      {s.lastError ? <div className="t-sub" style={{ maxWidth: 220 }}>{s.lastError}</div> : null}
                      {s.retryAfter && new Date(s.retryAfter) > ctx.now() ? <div className="t-sub">Backing off until {s.retryAfter.slice(11, 16)} UTC</div> : null}
                    </td>
                    <td style={{ maxWidth: 280 }}><Chip>{info.submissionCapability.replace(/_/g, " ").toLowerCase()}</Chip><div className="t-sub">{info.capabilityNotes}</div></td>
                    <td>{feed ? <div className="btns"><Act small url="/api/agent/sources" method="PATCH" body={{ id: s.id, sync: true }}>Sync now</Act><Act small url="/api/agent/sources" method="PATCH" body={{ id: s.id, enabled: !s.enabled }}>{s.enabled ? "Disable" : "Enable"}</Act><Act small variant="danger" url="/api/agent/sources" method="PATCH" body={{ id: s.id, remove: true }} confirm={`Remove ${s.name}? Jobs already found are kept.`}>Remove</Act></div> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid g2" style={{ alignItems: "start" }}>
          <div className="card">
            <div className="card-head"><h2>Add a published job board</h2></div>
            <JsonForm
              url="/api/agent/sources"
              submit="Add source"
              fields={[
                { name: "type", label: "ATS", type: "select", options: ["greenhouse", "lever", "ashby"] },
                { name: "name", label: "Company name", required: true },
                { name: "token", label: "Board token", required: true, hint: "greenhouse: boards.greenhouse.io/<token> · lever: jobs.lever.co/<slug> · ashby: jobs.ashbyhq.com/<name>" },
              ]}
            />
            <p className="hint">Only the employer&apos;s public, read-only feed is used, with rate-limit backoff. Adding a board never grants permission to submit applications.</p>
          </div>
          <div className="card">
            <div className="card-head"><h2>Not connected</h2></div>
            <ul className="list">
              {UNCONNECTED_PROVIDERS.map((p) => <li key={p.name}><b>{p.name}</b> <Chip>Not connected</Chip><div className="t-sub">{p.note}</div></li>)}
            </ul>
            <Notice tone="info">LinkedIn and UAE job boards are supported through what you paste or forward (Discover Jobs), not through scraping or automation.</Notice>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Available connectors</h2></div>
          <ul className="list">{infos.map((i) => <li key={i.type}><b>{i.label}</b> <span className="t-sub">· {i.retrievalMethod}</span><div className="t-sub">{i.capabilityNotes}</div></li>)}</ul>
        </div>
      </div>
    </Page>
  );
}
