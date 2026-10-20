import fs from "node:fs";
import { MemoryBlobStore, MemoryStore } from "@/lib/agent/store/store";
import { NullProvider, type LlmProvider } from "@/lib/agent/llm/provider";
import { defaultPreferences } from "@/lib/agent/defaults";
import { parseCvText } from "@/lib/agent/profile/import";
import type { Ctx } from "@/lib/agent/ctx";
import type { Profile } from "@/lib/agent/types";

export const NOW = new Date("2026-10-20T09:00:00Z");

export function verifyAll(p: Profile): Profile {
  return {
    ...p,
    entries: p.entries.map((e) => ({ ...e, verified: true })),
    facts: p.facts.map((f) => ({ ...f, verified: true, verifiedAt: NOW.toISOString() })),
    skills: p.skills.map((s) => ({ ...s, verified: true })),
  };
}

export function sampleProfile(verified = true): Profile {
  const text = fs.readFileSync("tests/fixtures/sample-cv.txt", "utf8");
  const { profile } = parseCvText(text, "doc_original", NOW.toISOString());
  return verified ? verifyAll(profile) : profile;
}

export async function makeCtx(opts: { llm?: LlmProvider; fetch?: Ctx["fetch"]; env?: Ctx["env"]; withProfile?: boolean } = {}): Promise<Ctx> {
  const ctx: Ctx = {
    store: new MemoryStore(),
    blobs: new MemoryBlobStore(),
    llm: opts.llm ?? new NullProvider(),
    fetch: opts.fetch ?? (async () => new Response("no network in tests", { status: 599 })),
    now: () => NOW,
    env: opts.env ?? {},
  };
  await ctx.store.put("preferences", { ...defaultPreferences(), id: "prefs" });
  if (opts.withProfile !== false) await ctx.store.put("profile", { ...sampleProfile(), id: "profile" });
  return ctx;
}
