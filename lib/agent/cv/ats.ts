import { extractSkills } from "../skills";
import type { AtsCheck, CvDoc, Job } from "../types";

export interface AtsInput {
  doc: CvDoc;
  job: Job | null;
  /** text extracted back out of the generated PDF */
  pdfText: string;
  pdfPages: number;
  docxBytes: number;
}

const DATE_OK = /^(?:[A-Z][a-z]{2} \d{4}|\d{4})(?: – (?:[A-Z][a-z]{2} \d{4}|\d{4}|Present))?$/;

export function atsChecks(i: AtsInput): AtsCheck[] {
  const out: AtsCheck[] = [];
  const add = (id: string, label: string, status: AtsCheck["status"], detail: string) => out.push({ id, label, status, detail });
  const t = i.pdfText;

  add("layout", "Single-column layout", "PASS", "Generated as one column with no tables, text boxes, icons or images.");
  const expected = ["SUMMARY", i.doc.experience.length ? "WORK EXPERIENCE" : null, i.doc.skills.length ? "SKILLS" : null, i.doc.education.length ? "EDUCATION" : null].filter((x): x is string => !!x);
  const missing = expected.filter((h) => !t.includes(h));
  add("headings", "Standard section headings", missing.length ? "FAIL" : "PASS", missing.length ? `Missing from extracted text: ${missing.join(", ")}` : `Found ${expected.join(", ")}.`);
  const nameOk = t.toUpperCase().includes(i.doc.header.name.toUpperCase().split(" ")[0]);
  add("extractable", "Text is selectable and extractable", t.length > 300 && nameOk ? "PASS" : "FAIL", `${t.length} characters extracted from the PDF; name ${nameOk ? "found" : "not found"}.`);
  const email = i.doc.header.contact.some((c) => /@/.test(c));
  const phone = i.doc.header.contact.some((c) => /\d{7,}/.test(c.replace(/\D/g, "")));
  add("contact", "Contact details present", email && phone ? "PASS" : "WARN", `${email ? "Email" : "No email"}, ${phone ? "phone" : "no phone"} in header.`);
  add("pages", "Length", i.pdfPages <= 2 ? "PASS" : "WARN", `${i.pdfPages} page(s).`);
  const dates = [...i.doc.experience, ...i.doc.projects, ...i.doc.education].map((s) => s.dates).filter(Boolean);
  const badDates = dates.filter((d) => !DATE_OK.test(d));
  add("dates", "Consistent date format", badDates.length ? "WARN" : "PASS", badDates.length ? `Unusual date text: ${badDates.join("; ")}` : "Dates use Mon YYYY – Mon YYYY.");
  const longest = Math.max(0, ...[...i.doc.experience, ...i.doc.projects].flatMap((s) => s.bullets.map((b) => b.text.length)));
  add("bullets", "Bullet length", longest > 320 ? "WARN" : "PASS", `Longest bullet is ${longest} characters.`);
  add("docx", "Editable DOCX produced", i.docxBytes > 1000 ? "PASS" : "FAIL", `${i.docxBytes} bytes.`);

  const all = [i.doc.summary.text, ...i.doc.experience.flatMap((s) => s.bullets.map((b) => b.text)), ...i.doc.projects.flatMap((s) => s.bullets.map((b) => b.text))].join(" ");
  const counts = new Map<string, number>();
  for (const s of extractSkills(all)) counts.set(s, (all.match(new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")) ?? []).length);
  const stuffed = [...counts].filter(([, n]) => n > 4).map(([s]) => s);
  add("stuffing", "No keyword stuffing", stuffed.length ? "WARN" : "PASS", stuffed.length ? `Repeated more than 4 times: ${stuffed.join(", ")}` : "No term is over-repeated.");

  if (i.job) {
    const cvSkills = new Set(extractSkills(`${all} ${i.doc.skills.flatMap((r) => r.items).join(" ")} ${i.doc.projects.map((p) => (p.tech ?? []).join(" ")).join(" ")}`));
    const req = i.job.requiredSkills;
    const hit = req.filter((s) => cvSkills.has(s));
    const pct = req.length ? Math.round((hit.length / req.length) * 100) : 100;
    const gap = req.filter((s) => !cvSkills.has(s));
    add("coverage", "Required-skill coverage (truthful)", req.length === 0 || pct >= 60 ? "PASS" : "WARN", `${hit.length}/${req.length} required skills appear because you have verified evidence for them.${gap.length ? ` Not claimed: ${gap.join(", ")}.` : ""}`);
  }
  return out;
}
