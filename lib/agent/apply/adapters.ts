import type { Answer, Job, Profile } from "../types";
import type { FetchLike } from "../connectors/types";

export interface SubmissionRequest {
  idempotencyKey: string;
  job: Job;
  profile: Profile;
  cv: { filename: string; bytes: Uint8Array };
  coverLetterText: string | null;
  answers: Answer[];
}

export interface SubmissionResult {
  outcome: "SUCCEEDED" | "FAILED" | "UNKNOWN";
  retriable: boolean;
  reference: string | null;
  meta: Record<string, unknown>;
  error?: string;
}

export interface SubmissionAdapter {
  readonly provider: string;
  checkAvailability(job: Job): Promise<"OPEN" | "CLOSED" | "UNKNOWN">;
  submit(req: SubmissionRequest): Promise<SubmissionResult>;
}

/** In-memory fake employer. Never touches the network. Scripted outcomes make failure paths testable. */
export class SandboxAdapter implements SubmissionAdapter {
  readonly provider = "sandbox";
  readonly received = new Map<string, SubmissionRequest>();
  constructor(public script: ("ok" | "fail" | "fail-permanent" | "timeout" | "closed" | "no-reference")[] = []) {}
  async checkAvailability(job: Job) {
    return this.script[0] === "closed" ? "CLOSED" : job.availability === "CLOSED" ? "CLOSED" : "OPEN";
  }
  async submit(req: SubmissionRequest): Promise<SubmissionResult> {
    const step = this.script.shift() ?? "ok";
    if (step === "fail") return { outcome: "FAILED", retriable: true, reference: null, meta: { status: 503 }, error: "Sandbox temporarily unavailable" };
    if (step === "fail-permanent") return { outcome: "FAILED", retriable: false, reference: null, meta: { status: 422 }, error: "Sandbox rejected the application" };
    if (step === "timeout") {
      this.received.set(req.idempotencyKey, req); // the request may have been processed
      throw new Error("socket timeout");
    }
    if (step === "no-reference") return { outcome: "SUCCEEDED", retriable: false, reference: null, meta: { status: 200 } };
    // idempotent: the same key always yields the same confirmation
    this.received.set(req.idempotencyKey, req);
    return { outcome: "SUCCEEDED", retriable: false, reference: `SBX-${req.idempotencyKey.slice(0, 10)}`, meta: { status: 201, sandbox: true } };
  }
}

/**
 * Greenhouse Job Board API application POST. Needs the employer-issued board API key, so it is only
 * reachable when the capability registry resolves AUTHORIZED_API_SUBMISSION. Written from the public
 * docs and exercised against a mocked fetch only; it has not been run against a live board.
 */
export class GreenhouseAdapter implements SubmissionAdapter {
  readonly provider = "greenhouse";
  constructor(private apiKey: string, private boardToken: string, private fetchFn: FetchLike) {}
  async checkAvailability(job: Job) {
    try {
      const res = await this.fetchFn(`https://boards-api.greenhouse.io/v1/boards/${this.boardToken}/jobs/${encodeURIComponent(job.externalId ?? "")}`);
      return res.status === 404 ? "CLOSED" : res.ok ? "OPEN" : "UNKNOWN";
    } catch {
      return "UNKNOWN";
    }
  }
  async submit(req: SubmissionRequest): Promise<SubmissionResult> {
    const [first, ...rest] = req.profile.fullName.split(" ");
    const form = new FormData();
    form.set("first_name", first);
    form.set("last_name", rest.join(" ") || first);
    if (req.profile.email) form.set("email", req.profile.email);
    if (req.profile.phone) form.set("phone", req.profile.phone);
    form.set("resume", new Blob([req.cv.bytes as BlobPart], { type: "application/pdf" }), req.cv.filename);
    if (req.coverLetterText) form.set("cover_letter_text", req.coverLetterText);
    let res: Response;
    try {
      res = await this.fetchFn(`https://boards-api.greenhouse.io/v1/boards/${this.boardToken}/jobs/${encodeURIComponent(req.job.externalId ?? "")}`, {
        method: "POST",
        headers: { authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString("base64")}`, "idempotency-key": req.idempotencyKey },
        body: form,
      });
    } catch (e) {
      return { outcome: "UNKNOWN", retriable: false, reference: null, meta: {}, error: `Network error after send: ${(e as Error).message}` };
    }
    const body = await res.text().catch(() => "");
    if (res.ok && /success/i.test(body)) return { outcome: "SUCCEEDED", retriable: false, reference: `GH-${req.idempotencyKey.slice(0, 12)}`, meta: { status: res.status, body: body.slice(0, 200) } };
    if (res.status === 429 || res.status >= 500) return { outcome: "FAILED", retriable: true, reference: null, meta: { status: res.status }, error: `Provider responded ${res.status}` };
    return { outcome: "FAILED", retriable: false, reference: null, meta: { status: res.status, body: body.slice(0, 200) }, error: `Provider rejected the application (${res.status})` };
  }
}
