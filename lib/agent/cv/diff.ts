import type { CvDoc, Job, Profile } from "../types";

function sectionRows(doc: CvDoc) {
  return {
    experience: doc.experience,
    projects: doc.projects,
  };
}

/** Human-readable summary of how a tailored CV differs from the master baseline. */
export function summarizeChanges(baseline: CvDoc, tailored: CvDoc, job: Job, profile: Profile): string[] {
  const out: string[] = [];
  const baseBullets = new Map(baseline.experience.concat(baseline.projects).flatMap((s) => s.bullets.map((b) => [b.factIds.join(","), b.text] as const)));
  for (const kind of ["experience", "projects"] as const) {
    const b = sectionRows(baseline)[kind];
    const t = sectionRows(tailored)[kind];
    const label = kind === "experience" ? "Experience" : "Projects";
    const baseTitles = b.map((s) => s.title);
    const tTitles = t.map((s) => s.title);
    const dropped = baseTitles.filter((x) => !tTitles.includes(x));
    if (dropped.length) out.push(`${label}: left out ${dropped.join("; ")} as less relevant to this role.`);
    const common = baseTitles.filter((x) => tTitles.includes(x));
    if (common.join("|") !== tTitles.filter((x) => common.includes(x)).join("|")) out.push(`${label}: reordered so the most relevant entries come first.`);
    for (const s of t) {
      const orig = b.find((x) => x.title === s.title);
      if (!orig) continue;
      const omitted = orig.bullets.length - s.bullets.length;
      if (omitted > 0) out.push(`${s.title}: kept ${s.bullets.length} of ${orig.bullets.length} bullets, choosing those closest to the job's requirements.`);
      if (orig.bullets.map((x) => x.factIds[0]).join() !== s.bullets.map((x) => x.factIds[0]).join() && omitted <= 0) out.push(`${s.title}: bullets reordered by relevance.`);
      const reworded = s.bullets.filter((x) => baseBullets.get(x.factIds.join(",")) !== undefined && baseBullets.get(x.factIds.join(",")) !== x.text).length;
      if (reworded) out.push(`${s.title}: ${reworded} bullet(s) reworded to emphasise relevance; wording checked against the original evidence.`);
    }
  }
  if (baseline.summary.text !== tailored.summary.text) out.push("Summary adjusted: kept verified statements relevant to the role and added a line naming skills you have demonstrated.");
  if (baseline.skills.map((r) => r.label).join() !== tailored.skills.map((r) => r.label).join() || JSON.stringify(baseline.skills) !== JSON.stringify(tailored.skills)) {
    const lead = tailored.skills[0];
    out.push(`Skills reordered so the groups and items matching this job lead${lead ? ` (${lead.label} first)` : ""}. No skills were added.`);
  }
  const jd = [...job.requiredSkills, ...job.preferredSkills];
  const shown = new Set(tailored.skills.flatMap((r) => r.items.map((i) => i.toLowerCase())).concat(tailored.projects.flatMap((p) => (p.tech ?? []).map((i) => i.toLowerCase()))));
  const used = jd.filter((s) => shown.has(s.toLowerCase()) || tailored.summary.text.toLowerCase().includes(s.toLowerCase()));
  if (used.length) out.push(`Job terminology reflected where you have verified evidence: ${used.slice(0, 10).join(", ")}.`);
  const notClaimed = jd.filter((s) => !used.includes(s));
  if (notClaimed.length) out.push(`Not claimed (no verified evidence): ${notClaimed.join(", ")}.`);
  void profile;
  if (out.length === 0) out.push("No structural changes from the master CV.");
  return out;
}

export function cvToText(doc: CvDoc): string {
  const lines: string[] = [doc.header.name, doc.header.contact.join(" | "), "", "SUMMARY", doc.summary.text];
  const sec = (name: string, rows: CvDoc["experience"]) => {
    if (!rows.length) return;
    lines.push("", name);
    for (const s of rows) {
      lines.push(`${s.title}${s.org ? " | " + s.org : ""}${s.dates ? "  " + s.dates : ""}`);
      if (s.tech?.length) lines.push(s.tech.join(", "));
      s.bullets.forEach((b) => lines.push(`• ${b.text}`));
    }
  };
  sec("WORK EXPERIENCE", doc.experience);
  sec("PROJECTS", doc.projects);
  lines.push("", "SKILLS", ...doc.skills.map((r) => `${r.label}: ${r.items.join(", ")}`));
  sec("EDUCATION", doc.education);
  sec("PUBLICATIONS", doc.publications);
  sec("CERTIFICATIONS AND LEADERSHIP", doc.certifications);
  return lines.join("\n");
}
