import type { CvDoc, CvSection } from "@/lib/agent/types";

type Mark = { gone?: Set<string>; changed?: Map<string, string> };

function Sec({ s, mark, kind }: { s: CvSection; mark?: Mark; kind: "orig" | "tail" }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div><b>{s.title}</b>{s.org ? <> | {s.org}</> : null}{s.dates ? <span className="sub"> &nbsp;{s.dates}</span> : null}</div>
      {s.tech?.length ? <div className="sub"><i>{s.tech.join(", ")}</i></div> : null}
      {s.bullets.length ? (
        <ul>
          {s.bullets.map((b, i) => {
            const id = b.factIds.join(",");
            const cls = kind === "orig" && mark?.gone?.has(id) ? "gone" : kind === "tail" && mark?.changed?.get(id) !== undefined && mark.changed.get(id) !== b.text ? "added" : "";
            return <li key={i} className={cls}>{b.text}</li>;
          })}
        </ul>
      ) : null}
    </div>
  );
}

export function CvPane({ doc, other, kind }: { doc: CvDoc; other?: CvDoc; kind: "orig" | "tail" }) {
  const ids = (d: CvDoc) => new Set([...d.experience, ...d.projects].flatMap((s) => s.bullets.map((b) => b.factIds.join(","))));
  const texts = (d: CvDoc) => new Map([...d.experience, ...d.projects].flatMap((s) => s.bullets.map((b) => [b.factIds.join(","), b.text] as const)));
  const mark: Mark | undefined = other ? (kind === "orig" ? { gone: new Set([...ids(doc)].filter((x) => !ids(other).has(x))) } : { changed: texts(other) }) : undefined;
  const block = (title: string, rows: CvSection[]) => rows.length ? (<><h4>{title}</h4>{rows.map((s) => <Sec key={s.entryId} s={s} mark={mark} kind={kind} />)}</>) : null;
  return (
    <div className="cvpane">
      <div style={{ textAlign: "center" }}><b style={{ fontSize: 15 }}>{doc.header.name.toUpperCase()}</b><div className="sub">{doc.header.contact.join("  |  ")}</div></div>
      <h4>SUMMARY</h4>
      <div>{doc.summary.text}</div>
      {block("WORK EXPERIENCE", doc.experience)}
      {block("PROJECTS", doc.projects)}
      <h4>SKILLS</h4>
      {doc.skills.map((r) => <div key={r.label}><b>{r.label}:</b> {r.items.join(", ")}</div>)}
      {block("EDUCATION", doc.education.map((s) => ({ ...s, bullets: s.bullets })))}
      {doc.publications.length ? <><h4>PUBLICATIONS</h4>{doc.publications.map((s) => <div key={s.entryId}>{s.title}</div>)}</> : null}
      {doc.certifications.length ? <><h4>CERTIFICATIONS AND LEADERSHIP</h4>{doc.certifications.map((s) => <div key={s.entryId}>{s.title}</div>)}</> : null}
    </div>
  );
}
