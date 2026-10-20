import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { CvDoc, CvSection } from "../types";

const PAGE = { w: 595.28, h: 841.89 };
const M = { x: 50, top: 48, bottom: 46 };
const INK = rgb(0.09, 0.09, 0.1);
const MUTED = rgb(0.35, 0.35, 0.38);
const RULE = rgb(0.6, 0.62, 0.66);

/** Standard PDF fonts are WinAnsi only. Replace anything else rather than emit garbage. */
function makeSafe(font: PDFFont) {
  const set = new Set(font.getCharacterSet());
  return (s: string) =>
    [...s.normalize("NFC")]
      .map((ch) => (set.has(ch.codePointAt(0)!) ? ch : /[‐-―]/.test(ch) ? "-" : /[‘’]/.test(ch) ? "'" : /[“”]/.test(ch) ? '"' : ch === " " ? " " : ch.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "?")))
      .join("");
}

export async function renderCvPdf(doc: CvDoc): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const safe = makeSafe(regular);
  pdf.setTitle("Curriculum Vitae");
  pdf.setCreator("Personal job agent");
  pdf.setProducer("pdf-lib");

  let page: PDFPage = pdf.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - M.top;
  const width = PAGE.w - M.x * 2;

  const ensure = (h: number) => {
    if (y - h < M.bottom) {
      page = pdf.addPage([PAGE.w, PAGE.h]);
      y = PAGE.h - M.top;
    }
  };
  const wrap = (text: string, font: PDFFont, size: number, w: number): string[] => {
    const out: string[] = [];
    let line = "";
    for (const word of safe(text).split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) <= w) line = test;
      else {
        if (line) out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
    return out;
  };
  const draw = (text: string, x: number, font: PDFFont, size: number, color = INK) => page.drawText(text, { x, y, size, font, color });

  // header: name + headline + contact, centred
  const nameSize = 20;
  const name = safe(doc.header.name.toUpperCase());
  ensure(nameSize);
  y -= nameSize * 0.8;
  draw(name, (PAGE.w - bold.widthOfTextAtSize(name, nameSize)) / 2, bold, nameSize);
  y -= 15;
  if (doc.header.contact.length) {
    for (const l of wrap(doc.header.contact.join("  |  "), regular, 9.5, width)) {
      draw(l, (PAGE.w - regular.widthOfTextAtSize(l, 9.5)) / 2, regular, 9.5, MUTED);
      y -= 12;
    }
  }
  y -= 4;

  const heading = (t: string) => {
    ensure(34);
    y -= 10;
    draw(t, M.x, bold, 10.5);
    y -= 4;
    page.drawLine({ start: { x: M.x, y }, end: { x: PAGE.w - M.x, y }, thickness: 0.6, color: RULE });
    y -= 11;
  };
  const para = (t: string, size = 10) => {
    for (const l of wrap(t, regular, size, width)) {
      ensure(size + 3);
      draw(l, M.x, regular, size);
      y -= size + 3.2;
    }
  };
  const bullet = (t: string) => {
    const indent = 12;
    const lines = wrap(t, regular, 10, width - indent);
    lines.forEach((l, i) => {
      ensure(13);
      if (i === 0) draw("•", M.x + 2, regular, 10);
      draw(l, M.x + indent, regular, 10);
      y -= 13;
    });
  };
  const entryHead = (s: CvSection, withOrg = true) => {
    ensure(28);
    const left = withOrg && s.org ? `${s.title}` : s.title;
    const dates = safe(s.dates);
    const dw = dates ? italic.widthOfTextAtSize(dates, 9.5) : 0;
    const titleLines = wrap(left, bold, 10, width - dw - 10);
    const orgText = withOrg && s.org ? `  |  ${safe(s.org)}` : "";
    titleLines.forEach((l, i) => {
      draw(l, M.x, bold, 10);
      if (i === titleLines.length - 1 && orgText) {
        const tw = bold.widthOfTextAtSize(l, 10);
        const ol = wrap(orgText.replace(/^\s+\|\s+/, ""), regular, 10, width - dw - tw - 24)[0] ?? "";
        draw(`|  ${ol}`, M.x + tw + 6, regular, 10);
      }
      if (i === 0 && dates) draw(dates, PAGE.w - M.x - dw, italic, 9.5, MUTED);
      y -= 13;
    });
    if (s.tech?.length) {
      for (const l of wrap(s.tech.join(", "), italic, 9.5, width)) {
        draw(l, M.x, italic, 9.5, MUTED);
        y -= 12;
      }
    }
  };

  if (doc.summary.text.trim()) {
    heading("SUMMARY");
    para(doc.summary.text);
  }
  if (doc.experience.length) {
    heading("WORK EXPERIENCE");
    for (const s of doc.experience) {
      entryHead(s);
      s.bullets.forEach((b) => bullet(b.text));
      y -= 3;
    }
  }
  if (doc.projects.length) {
    heading("PROJECTS");
    for (const s of doc.projects) {
      entryHead(s, false);
      s.bullets.forEach((b) => bullet(b.text));
      y -= 3;
    }
  }
  if (doc.skills.length) {
    heading("SKILLS");
    for (const r of doc.skills) {
      const label = `${safe(r.label)}: `;
      const lw = bold.widthOfTextAtSize(label, 10);
      const lines = wrap(r.items.join(", "), regular, 10, width - lw);
      lines.forEach((l, i) => {
        ensure(13);
        if (i === 0) draw(label, M.x, bold, 10);
        draw(l, M.x + (i === 0 ? lw : lw), regular, 10);
        y -= 13;
      });
    }
  }
  if (doc.education.length) {
    heading("EDUCATION");
    for (const s of doc.education) {
      entryHead({ ...s, org: "" }, false);
      para([s.org, ...s.bullets.map((b) => b.text)].filter(Boolean).join("  |  "));
    }
  }
  if (doc.publications.length) {
    heading("PUBLICATIONS");
    for (const s of doc.publications) para(s.title);
  }
  if (doc.certifications.length) {
    heading("CERTIFICATIONS AND LEADERSHIP");
    for (const s of doc.certifications) para(s.title);
  }
  return pdf.save();
}

export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}

/** Plain letter layout used for cover letters. */
export async function renderLetterPdf(opts: { name: string; contact: string[]; employer: string; title: string; paragraphs: string[]; dateLabel: string }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const safe = makeSafe(regular);
  pdf.setTitle("Cover letter");
  let page = pdf.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - 60;
  const width = PAGE.w - 120;
  const line = (t: string, font: PDFFont, size: number) => {
    if (y < 60) {
      page = pdf.addPage([PAGE.w, PAGE.h]);
      y = PAGE.h - 60;
    }
    page.drawText(t, { x: 60, y, size, font, color: INK });
    y -= size + 4;
  };
  const wrapped = (t: string, font: PDFFont, size: number) => {
    let cur = "";
    for (const w of safe(t).split(/\s+/)) {
      const test = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) <= width) cur = test;
      else {
        line(cur, font, size);
        cur = w;
      }
    }
    if (cur) line(cur, font, size);
  };
  line(safe(opts.name), bold, 14);
  wrapped(opts.contact.join("  |  "), regular, 9.5);
  y -= 14;
  line(opts.dateLabel, regular, 10);
  y -= 8;
  line(safe(`Re: ${opts.title}, ${opts.employer}`), bold, 10.5);
  y -= 8;
  for (const p of opts.paragraphs) {
    wrapped(p, regular, 10.5);
    y -= 8;
  }
  return pdf.save();
}
