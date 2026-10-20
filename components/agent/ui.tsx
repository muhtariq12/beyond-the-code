import Link from "next/link";
import type { ReactNode } from "react";
import { STATUS_TONE } from "@/lib/agent/format";
import type { Application, Check } from "@/lib/agent/types";

export function Page({ title, sub, actions, children }: { title: string; sub?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="head">
        <div>
          <h1>{title}</h1>
          {sub ? <p>{sub}</p> : null}
        </div>
        {actions ? <div className="btns">{actions}</div> : null}
      </div>
      {children}
    </>
  );
}

export function Chip({ tone = "", children, title }: { tone?: string; children: ReactNode; title?: string }) {
  return (
    <span className={`chip ${tone}`} title={title}>
      {children}
    </span>
  );
}

export function StatusChip({ status }: { status: Application["status"] }) {
  return (
    <Chip tone={STATUS_TONE[status]}>
      <span className="dot" />
      {status.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}
    </Chip>
  );
}

export function Score({ value, ineligible }: { value: number | null | undefined; ineligible?: boolean }) {
  if (ineligible) return <span className="score none" title="Failed a hard eligibility check">–</span>;
  if (value == null) return <span className="score none">n/a</span>;
  return <span className={`score ${value >= 70 ? "hi" : value >= 50 ? "mid" : "lo"}`}>{value}</span>;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card empty">
      <h3>{title}</h3>
      {children ? <p style={{ margin: "0 auto 12px", maxWidth: 480 }}>{children}</p> : null}
      {action}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "bad" | "ok"; children: ReactNode }) {
  return <div className={`notice ${tone}`}>{children}</div>;
}

export function Metric({ n, label, sub }: { n: ReactNode; label: string; sub?: ReactNode }) {
  return (
    <div className="metric">
      <div className="n">{n}</div>
      <div className="l">{label}</div>
      <div className="s">{sub}</div>
    </div>
  );
}

export function Tabs({ items, current }: { items: { href: string; label: string; key: string }[]; current: string }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((i) => (
        <Link key={i.key} href={i.href} aria-current={i.key === current ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </div>
  );
}

export function Checks({ checks }: { checks: Check[] }) {
  return (
    <div className="tablewrap">
      <table>
        <thead><tr><th>Check</th><th>Result</th><th>Reason</th></tr></thead>
        <tbody>
          {checks.map((c) => (
            <tr key={c.id}>
              <td className="t-title" style={{ whiteSpace: "nowrap" }}>{c.label}</td>
              <td><Chip tone={c.result === "PASS" ? "ok" : c.result === "FAIL" ? "bad" : "warn"}>{c.result === "UNKNOWN" ? "Uncertain" : c.result === "PASS" ? "Pass" : "Fail"}</Chip></td>
              <td>{c.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Bar({ value }: { value: number }) {
  return (
    <div className="bar" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </div>
  );
}
