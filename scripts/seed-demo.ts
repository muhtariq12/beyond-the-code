/**
 * Loads a clearly fictional demo dataset (candidate "Alex Sample", employers "Acme AI"/"Globex"/"Initech")
 * into AGENT_DATA_DIR (default ./data-demo) so the dashboard can be explored. Never touches real data.
 *   AGENT_DATA_DIR=./data-demo npm run seed:demo && AGENT_DATA_DIR=./data-demo AGENT_AUTH_DISABLED=1 npm run dev
 */
import fs from "node:fs";
import path from "node:path";
import { GREENHOUSE_BOARD, LEVER_POSTINGS, ASHBY_BOARD } from "../tests/fixtures/jobs";

process.env.AGENT_DATA_DIR ??= "./data-demo";

async function main() {
  const { getCtx } = await import("../lib/agent/runtime");
  const { parseCvText } = await import("../lib/agent/profile/import");
  const { saveDocument } = await import("../lib/agent/cv/service");
  const { greenhouse } = await import("../lib/agent/connectors/greenhouse");
  const { lever } = await import("../lib/agent/connectors/lever");
  const { ashby } = await import("../lib/agent/connectors/ashby");
  const { upsertRawJobs, screenAll, generateForQualified } = await import("../lib/agent/ops/pipeline");

  const ctx = await getCtx();
  if ((await ctx.store.list("jobs")).length) return console.log("Demo data already present in", process.env.AGENT_DATA_DIR);
  const text = fs.readFileSync(path.resolve("tests/fixtures/sample-cv.txt"), "utf8");
  const bytes = new Uint8Array(Buffer.from(text));
  const doc = await saveDocument(ctx, { kind: "ORIGINAL_CV", filename: "Original_CV_demo.txt", mime: "text/plain", jobId: null, cvVersionId: null }, bytes);
  const { profile } = parseCvText(text, doc.id, ctx.now().toISOString());
  const now = ctx.now().toISOString();
  await ctx.store.put("profile", {
    ...profile, id: "profile",
    entries: profile.entries.map((e) => ({ ...e, verified: true })),
    facts: profile.facts.map((f) => ({ ...f, verified: true, verifiedAt: now })),
    skills: profile.skills.map((s) => ({ ...s, verified: true })),
  });

  const fakeFetch = (routes: Record<string, unknown>) => async (url: string) => {
    const hit = Object.entries(routes).find(([k]) => url.startsWith(k));
    return hit ? new Response(JSON.stringify(hit[1]), { status: 200 }) : new Response("", { status: 404 });
  };
  const mk = (id: string, type: "greenhouse" | "lever" | "ashby", name: string, token: string) => ({ id, type, name, token, enabled: true, lastAttemptAt: now, lastSuccessAt: now, lastError: null, lastJobCount: null, retryAfter: null, createdAt: now });
  const sources = [mk("src_demo_gh", "greenhouse", "Acme AI (demo)", "acmeai"), mk("src_demo_lv", "lever", "Globex AI (demo)", "globexai"), mk("src_demo_as", "ashby", "Initech (demo)", "initech")];
  for (const s of sources) await ctx.store.put("sources", s);
  const c = (routes: Record<string, unknown>) => ({ fetch: fakeFetch(routes) as never, now: ctx.now });
  const raws = [
    ...(await greenhouse.fetchJobs(sources[0], c({ "https://boards-api.greenhouse.io": GREENHOUSE_BOARD }))),
    ...(await lever.fetchJobs(sources[1], c({ "https://api.lever.co": LEVER_POSTINGS }))),
    ...(await ashby.fetchJobs(sources[2], c({ "https://api.ashbyhq.com": ASHBY_BOARD }))),
  ];
  await upsertRawJobs(ctx, raws);
  await screenAll(ctx);
  const g = await generateForQualified(ctx);
  console.log(`DEMO DATA loaded into ${process.env.AGENT_DATA_DIR}: ${raws.length} fictional jobs, ${g.generated} tailored CVs. Nothing here is real.`);
}
void main();
