import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  Answer, Application, AppEvent, AuditEntry, CoverLetter, CvVersion, Job, Match, Notification,
  Preferences, Profile, Source, StoredDocument, SubmissionAttempt,
} from "../types";

export type ProfileRecord = Profile & { id: "profile" };
export type PreferencesRecord = Preferences & { id: "prefs" };
export type MetaRecord = { id: string; value: unknown };

export interface Collections {
  profile: ProfileRecord;
  preferences: PreferencesRecord;
  sources: Source;
  jobs: Job;
  matches: Match;
  cvVersions: CvVersion;
  documents: StoredDocument;
  coverLetters: CoverLetter;
  applications: Application;
  answers: Answer;
  attempts: SubmissionAttempt;
  events: AppEvent;
  notifications: Notification;
  audit: AuditEntry;
  meta: MetaRecord;
}
export type CollectionName = keyof Collections;

export interface Store {
  list<K extends CollectionName>(c: K): Promise<Collections[K][]>;
  get<K extends CollectionName>(c: K, id: string): Promise<Collections[K] | null>;
  put<K extends CollectionName>(c: K, rec: Collections[K]): Promise<Collections[K]>;
  delete(c: CollectionName, id: string): Promise<void>;
}

export class ImmutableViolation extends Error {}

type Guard = (existing: never, next: never) => void;

/** CV versions are immutable except for review status, notes and attached document ids (set once). */
const guards: Partial<Record<CollectionName, Guard>> = {
  cvVersions: ((a: CvVersion, b: CvVersion) => {
    const mutable = new Set(["status", "reviewedAt", "notes", "pdfDocId", "docxDocId"]);
    for (const k of Object.keys(a) as (keyof CvVersion)[]) {
      if (mutable.has(k)) continue;
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) throw new ImmutableViolation(`CV version ${a.id} is immutable (attempted change to "${k}"). Create a new version instead.`);
    }
    for (const k of ["pdfDocId", "docxDocId"] as const) {
      if (a[k] && a[k] !== b[k]) throw new ImmutableViolation(`CV version ${a.id}: ${k} already set`);
    }
    if (a.status === "APPROVED" && b.status === "DRAFT") throw new ImmutableViolation("An approved CV cannot silently return to draft.");
  }) as unknown as Guard,
  documents: ((a: StoredDocument, b: StoredDocument) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new ImmutableViolation(`Document ${a.id} is write-once`);
  }) as unknown as Guard,
  events: ((a: AppEvent) => {
    throw new ImmutableViolation(`Event ${a.id} is append-only`);
  }) as unknown as Guard,
  audit: ((a: AuditEntry) => {
    throw new ImmutableViolation(`Audit entry ${a.id} is append-only`);
  }) as unknown as Guard,
};

type Data = { [K in CollectionName]: Record<string, Collections[K]> };

function emptyData(): Data {
  return {
    profile: {}, preferences: {}, sources: {}, jobs: {}, matches: {}, cvVersions: {}, documents: {},
    coverLetters: {}, applications: {}, answers: {}, attempts: {}, events: {}, notifications: {}, audit: {}, meta: {},
  };
}

export class MemoryStore implements Store {
  protected data: Data = emptyData();

  async list<K extends CollectionName>(c: K): Promise<Collections[K][]> {
    return Object.values(this.data[c]).map((r) => structuredClone(r)) as Collections[K][];
  }
  async get<K extends CollectionName>(c: K, id: string): Promise<Collections[K] | null> {
    const r = this.data[c][id];
    return r ? (structuredClone(r) as Collections[K]) : null;
  }
  async put<K extends CollectionName>(c: K, rec: Collections[K]): Promise<Collections[K]> {
    const existing = this.data[c][rec.id];
    if (existing) (guards[c] as ((a: unknown, b: unknown) => void) | undefined)?.(existing, rec);
    (this.data[c] as Record<string, unknown>)[rec.id] = structuredClone(rec);
    await this.persist();
    return rec;
  }
  async delete(c: CollectionName, id: string): Promise<void> {
    if (c === "events" || c === "audit" || c === "cvVersions" || c === "documents") throw new ImmutableViolation(`${c} records cannot be deleted`);
    delete this.data[c][id];
    await this.persist();
  }
  protected async persist(): Promise<void> {}
}

/** Single-user JSON file store. Writes are atomic (temp file + rename) and serialised. */
export class FileStore extends MemoryStore {
  private queue: Promise<void> = Promise.resolve();
  constructor(private file: string) {
    super();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (fs.existsSync(file)) this.data = { ...emptyData(), ...JSON.parse(fs.readFileSync(file, "utf8")) };
  }
  protected persist(): Promise<void> {
    const snapshot = JSON.stringify(this.data);
    this.queue = this.queue.then(async () => {
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.promises.writeFile(tmp, snapshot, { mode: 0o600 });
      await fs.promises.rename(tmp, this.file);
    });
    return this.queue;
  }
}

/* ---------- private blob storage (CVs and generated documents) ---------- */

export interface BlobStore {
  put(id: string, bytes: Uint8Array): Promise<void>;
  get(id: string): Promise<Uint8Array | null>;
}

export class MemoryBlobStore implements BlobStore {
  private m = new Map<string, Uint8Array>();
  async put(id: string, bytes: Uint8Array) {
    if (this.m.has(id)) throw new ImmutableViolation(`Blob ${id} is write-once`);
    this.m.set(id, bytes);
  }
  async get(id: string) {
    return this.m.get(id) ?? null;
  }
}

export class FileBlobStore implements BlobStore {
  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  private p(id: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Bad blob id");
    return path.join(this.dir, id);
  }
  async put(id: string, bytes: Uint8Array) {
    try {
      await fs.promises.writeFile(this.p(id), bytes, { flag: "wx", mode: 0o600 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new ImmutableViolation(`Blob ${id} is write-once`);
      throw e;
    }
  }
  async get(id: string) {
    try {
      return await fs.promises.readFile(this.p(id));
    } catch {
      return null;
    }
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}
export function sha256(bytes: Uint8Array | string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
