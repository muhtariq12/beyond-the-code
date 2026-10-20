import { AlignmentType, Document, HeadingLevel, LevelFormat, Packer, Paragraph, TabStopType, TextRun } from "docx";
import type { CvDoc } from "../types";

const FONT = "Calibri";
const RIGHT_TAB = 10000; // twips, inside A4 with 0.7" margins

const heading = (text: string) =>
  new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 80 }, border: { bottom: { style: "single", size: 4, color: "999999", space: 2 } }, children: [new TextRun({ text, bold: true, size: 21, font: FONT })] });

const body = (text: string) => new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text, size: 20, font: FONT })] });

const bullet = (text: string) =>
  new Paragraph({ numbering: { reference: "cv-bullets", level: 0 }, spacing: { after: 30 }, children: [new TextRun({ text, size: 20, font: FONT })] });

/** Editable, single-column DOCX using real heading styles, no tables, no text boxes. */
export async function renderCvDocx(doc: CvDoc): Promise<Uint8Array> {
  const children: Paragraph[] = [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: doc.header.name.toUpperCase(), bold: true, size: 40, font: FONT })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: doc.header.contact.join("  |  "), size: 19, font: FONT, color: "555555" })] }),
  ];
  const entry = (title: string, org: string, dates: string, tech?: string[]) => {
    children.push(
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB }],
        spacing: { before: 100, after: 20 },
        keepNext: true,
        children: [
          new TextRun({ text: title, bold: true, size: 20, font: FONT }),
          ...(org ? [new TextRun({ text: `  |  ${org}`, size: 20, font: FONT })] : []),
          ...(dates ? [new TextRun({ text: `\t${dates}`, italics: true, size: 19, font: FONT, color: "555555" })] : []),
        ],
      }),
    );
    if (tech?.length) children.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: tech.join(", "), italics: true, size: 19, font: FONT, color: "555555" })] }));
  };

  if (doc.summary.text.trim()) children.push(heading("SUMMARY"), body(doc.summary.text));
  if (doc.experience.length) {
    children.push(heading("WORK EXPERIENCE"));
    for (const s of doc.experience) {
      entry(s.title, s.org, s.dates);
      s.bullets.forEach((b) => children.push(bullet(b.text)));
    }
  }
  if (doc.projects.length) {
    children.push(heading("PROJECTS"));
    for (const s of doc.projects) {
      entry(s.title, "", s.dates, s.tech);
      s.bullets.forEach((b) => children.push(bullet(b.text)));
    }
  }
  if (doc.skills.length) {
    children.push(heading("SKILLS"));
    for (const r of doc.skills) children.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: `${r.label}: `, bold: true, size: 20, font: FONT }), new TextRun({ text: r.items.join(", "), size: 20, font: FONT })] }));
  }
  if (doc.education.length) {
    children.push(heading("EDUCATION"));
    for (const s of doc.education) {
      entry(s.title, "", s.dates);
      children.push(body([s.org, ...s.bullets.map((b) => b.text)].filter(Boolean).join("  |  ")));
    }
  }
  if (doc.publications.length) {
    children.push(heading("PUBLICATIONS"));
    doc.publications.forEach((s) => children.push(body(s.title)));
  }
  if (doc.certifications.length) {
    children.push(heading("CERTIFICATIONS AND LEADERSHIP"));
    doc.certifications.forEach((s) => children.push(body(s.title)));
  }

  const d = new Document({
    creator: "Personal job agent",
    title: "Curriculum Vitae",
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    numbering: { config: [{ reference: "cv-bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 220 } } } }] }] },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } }, children }],
  });
  return new Uint8Array(await Packer.toBuffer(d));
}

export async function renderLetterDocx(opts: { name: string; contact: string[]; employer: string; title: string; paragraphs: string[]; dateLabel: string }): Promise<Uint8Array> {
  const d = new Document({
    title: "Cover letter",
    sections: [{ children: [
      new Paragraph({ children: [new TextRun({ text: opts.name, bold: true, size: 28, font: FONT })] }),
      new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: opts.contact.join("  |  "), size: 19, font: FONT })] }),
      new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: opts.dateLabel, size: 21, font: FONT })] }),
      new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: `Re: ${opts.title}, ${opts.employer}`, bold: true, size: 21, font: FONT })] }),
      ...opts.paragraphs.map((p) => new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: p, size: 21, font: FONT })] })),
    ] }],
  });
  return new Uint8Array(await Packer.toBuffer(d));
}
