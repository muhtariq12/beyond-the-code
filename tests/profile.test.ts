import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCvText, mergeReimport } from "@/lib/agent/profile/import";
import { profileIssues, professionalMonths } from "@/lib/agent/profile/facts";
import { sniffCvKind, UploadError, extractCvText } from "@/lib/agent/profile/extract";

const text = fs.readFileSync("tests/fixtures/sample-cv.txt", "utf8");
const NOW = new Date("2026-10-20T00:00:00Z");

describe("CV import", () => {
  const { profile, warnings } = parseCvText(text, "doc_1", NOW.toISOString());

  it("parses header, entries, bullets and skills", () => {
    expect(profile.fullName).toBe("ALEX SAMPLE");
    expect(profile.email).toBe("alex.sample@example.com");
    expect(profile.entries.filter((e) => e.type === "EMPLOYMENT").map((e) => e.title)).toEqual([
      "AI Engineer", "Software Engineering Intern", "Freelance Web Developer",
    ]);
    const job = profile.entries.find((e) => e.title === "AI Engineer")!;
    expect(job.start).toBe("2026-08");
    expect(job.current).toBe(true);
    expect(profile.facts.filter((f) => f.entryId === job.id)).toHaveLength(3);
    expect(profile.entries.filter((e) => e.type === "PROJECT")).toHaveLength(2);
    expect(profile.entries.find((e) => e.type === "EDUCATION")?.org).toBe("Example University");
    expect(profile.entries.filter((e) => e.type === "CERTIFICATION")).toHaveLength(3);
    expect(profile.entries.filter((e) => e.type === "AWARD")).toHaveLength(1);
    expect(profile.skills.find((s) => s.label === "fine-tuning (LoRA)")?.name).toBe("Fine-tuning");
    expect(warnings).toEqual([]);
  });

  it("joins wrapped bullet lines and extracts metrics only from the text", () => {
    const wrapped = parseCvText("A B\nSUMMARY\nHi.\nWORK EXPERIENCE\nDev | Org Jan 2024 – Present\n• Built a thing that\nsaves 30% of time\n", "d", NOW.toISOString());
    const f = wrapped.profile.facts.find((x) => x.entryId)!;
    expect(f.text).toBe("Built a thing that saves 30% of time");
    expect(f.metrics).toEqual(["30"]);
    const pp = profile.facts.find((x) => x.text.includes("RMSE"))!;
    expect(pp.metrics).toEqual(expect.arrayContaining(["20000", "1200", "0.81"]));
  });

  it("imports everything unverified", () => {
    expect(profile.facts.every((f) => !f.verified)).toBe(true);
    expect(profile.entries.every((e) => !e.verified)).toBe(true);
  });

  it("keeps verification across an unchanged re-import", () => {
    const verified = { ...profile, facts: profile.facts.map((f, i) => (i === 0 ? { ...f, verified: true, verifiedAt: "x" } : f)) };
    const again = mergeReimport(verified, parseCvText(text, "doc_2", NOW.toISOString()).profile);
    expect(again.facts[0].verified).toBe(true);
    expect(again.facts[1].verified).toBe(false);
  });

  it("flags overlapping employment dates as questions instead of fixing them", () => {
    const v = { ...profile, entries: profile.entries.map((e) => ({ ...e, verified: true })), facts: profile.facts.map((f) => ({ ...f, verified: true })), skills: profile.skills.map((s) => ({ ...s, verified: true })) };
    const issues = profileIssues(v, NOW).map((i) => i.text).join("\n");
    expect(issues).toMatch(/overlapping dates/);
    expect(professionalMonths(v, NOW)).toBeGreaterThan(0);
  });
});

describe("upload validation", () => {
  it("rejects wrong types, empty and oversize files", () => {
    expect(() => sniffCvKind(new Uint8Array(), "a.pdf")).toThrow(UploadError);
    expect(() => sniffCvKind(new Uint8Array(6 * 1024 * 1024), "a.pdf")).toThrow(/5 MB/);
    expect(() => sniffCvKind(Buffer.from("MZ\x90\x00"), "cv.pdf")).toThrow(UploadError);
    expect(sniffCvKind(Buffer.from("%PDF-1.7"), "cv.pdf")).toBe("pdf");
  });
  it("extracts text from txt", async () => {
    const r = await extractCvText(Buffer.from("hello\n\n\nworld"), "cv.txt");
    expect(r.text).toBe("hello\n\nworld");
  });
});
