import JSZip from "jszip";
import { decodeEntities, normalizeWhitespace, stripControl } from "../text";

export const MAX_CV_BYTES = 5 * 1024 * 1024;

export type CvFileKind = "pdf" | "docx" | "txt";

export class UploadError extends Error {}

/** Validate by size and magic bytes, never by filename or client-supplied MIME alone. */
export function sniffCvKind(bytes: Uint8Array, filename: string): CvFileKind {
  if (bytes.byteLength === 0) throw new UploadError("The file is empty.");
  if (bytes.byteLength > MAX_CV_BYTES) throw new UploadError("The file is larger than 5 MB.");
  const head = Buffer.from(bytes.slice(0, 5)).toString("latin1");
  if (head.startsWith("%PDF-")) return "pdf";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && /\.docx$/i.test(filename)) return "docx";
  if (/\.(txt|md)$/i.test(filename)) {
    const sample = Buffer.from(bytes.slice(0, 2000));
    if (sample.includes(0)) throw new UploadError("That does not look like a text file.");
    return "txt";
  }
  throw new UploadError("Unsupported file type. Upload a PDF, DOCX, TXT or MD file.");
}

export async function extractCvText(bytes: Uint8Array, filename: string): Promise<{ kind: CvFileKind; text: string }> {
  const kind = sniffCvKind(bytes, filename);
  if (kind === "txt") return { kind, text: normalizeWhitespace(stripControl(Buffer.from(bytes).toString("utf8"))) };
  if (kind === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    return { kind, text: normalizeWhitespace(stripControl(text)) };
  }
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new UploadError("Not a valid DOCX file.");
  const text = decodeEntities(
    xml
      .replace(/<w:tab\/>/g, " ")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<w:br\/>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  );
  return { kind, text: normalizeWhitespace(stripControl(text)) };
}
