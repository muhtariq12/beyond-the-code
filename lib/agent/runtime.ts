import path from "node:path";
import type { Ctx } from "./ctx";
import { defaultPreferences } from "./defaults";
import { providerFromEnv } from "./llm/provider";
import { FileBlobStore, FileStore } from "./store/store";

const g = globalThis as unknown as { __agentCtx?: Promise<Ctx> };

/** Process-wide context for route handlers and the worker. Data lives under AGENT_DATA_DIR (default ./data, git-ignored). */
export function getCtx(): Promise<Ctx> {
  g.__agentCtx ??= (async () => {
    const dir = path.resolve(process.env.AGENT_DATA_DIR ?? "data");
    const store = new FileStore(path.join(dir, "store.json"));
    if (!(await store.get("preferences", "prefs"))) await store.put("preferences", { ...defaultPreferences(), id: "prefs" });
    return {
      store,
      blobs: new FileBlobStore(path.join(dir, "private")),
      llm: providerFromEnv(process.env),
      fetch: (u, i) => fetch(u, i),
      now: () => new Date(),
      env: process.env,
    } satisfies Ctx;
  })();
  return g.__agentCtx;
}
