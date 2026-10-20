/**
 * Background worker: `npm run worker`. Each tick runs only the steps whose configured interval has elapsed
 * (ingest, screen/score/generate, reconcile, daily summary). Safe to run alongside the web app on the same data dir.
 */
import { getCtx } from "../lib/agent/runtime";
import { runDue } from "../lib/agent/ops/pipeline";

const TICK_MS = Number(process.env.WORKER_TICK_SECONDS ?? 60) * 1000;

async function tick() {
  try {
    const ctx = await getCtx();
    const out = await runDue(ctx);
    if (Object.keys(out).length) console.log(new Date().toISOString(), JSON.stringify(out).slice(0, 400));
  } catch (e) {
    console.error(new Date().toISOString(), "worker tick failed:", (e as Error).message);
  }
}

console.log(`Job agent worker started (tick every ${TICK_MS / 1000}s). Ctrl+C to stop.`);
void tick();
setInterval(tick, TICK_MS);
