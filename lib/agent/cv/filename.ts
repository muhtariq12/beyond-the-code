import { sanitizeFilenamePart } from "../text";

/** Company_Role_CV_YYYY-MM-DD.ext. Contains no personal data, only employer, role and date. */
export function cvFilename(employer: string, title: string, date: Date, ext: "pdf" | "docx", suffix = "CV"): string {
  const d = date.toISOString().slice(0, 10);
  return `${sanitizeFilenamePart(employer, 30)}_${sanitizeFilenamePart(title, 40)}_${suffix}_${d}.${ext}`;
}
