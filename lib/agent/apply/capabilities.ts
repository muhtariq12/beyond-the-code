import type { Ctx } from "../ctx";
import type { Preferences } from "../types";
import { GreenhouseAdapter, SandboxAdapter, type SubmissionAdapter } from "./adapters";

export type Capability = "DISCOVERY_ONLY" | "PREPARE_AND_HANDOFF" | "AUTHORIZED_API_SUBMISSION" | "DISABLED";

export interface CapabilityDecision {
  provider: string;
  state: Capability;
  reason: string;
}

const CREDENTIAL_ENV: Record<string, string> = { greenhouse: "GREENHOUSE_JOB_BOARD_API_KEY" };
const IMPLEMENTED = new Set(["greenhouse", "sandbox"]);

/**
 * Capability is decided only from explicit configuration: the global kill switch, a documented
 * authorisation basis you recorded for that provider, a credential, and an implemented adapter.
 * The existence of a public endpoint never grants submission.
 */
export function resolveCapability(provider: string, prefs: Preferences, env: Record<string, string | undefined>, adapters?: Ctx["adapters"]): CapabilityDecision {
  const d = (state: Capability, reason: string): CapabilityDecision => ({ provider, state, reason });
  if (env.AGENT_DISABLE_SUBMISSION === "1") return d("DISABLED", "Submission is disabled globally (AGENT_DISABLE_SUBMISSION=1).");
  if (provider === "linkedin") return d("DISCOVERY_ONLY", "LinkedIn automation is not permitted; use alerts or pasted descriptions and apply yourself.");
  if (provider === "sandbox") {
    return env.AGENT_ENABLE_SANDBOX === "1" || adapters?.sandbox
      ? d("AUTHORIZED_API_SUBMISSION", "Sandbox employer: no real application is ever sent.")
      : d("DISABLED", "Sandbox disabled (set AGENT_ENABLE_SANDBOX=1).");
  }
  if (provider === "email") return d("PREPARE_AND_HANDOFF", "Alert-email jobs link to the employer's own page; the package is prepared and you apply there.");
  const cfg = prefs.authorizedSubmission[provider];
  if (!cfg?.enabled) return d("PREPARE_AND_HANDOFF", "No documented authorisation to submit via this provider; package is prepared and the original page is opened for you.");
  if (!cfg.basis.trim()) return d("PREPARE_AND_HANDOFF", "Authorisation enabled but no basis recorded (e.g. employer-issued API key and terms reference).");
  const credEnv = CREDENTIAL_ENV[provider];
  if (!IMPLEMENTED.has(provider) && !adapters?.[provider]) return d("PREPARE_AND_HANDOFF", `No submission adapter is implemented for ${provider}.`);
  if (credEnv && !env[credEnv] && !adapters?.[provider]) return d("PREPARE_AND_HANDOFF", `Credential ${credEnv} is not set.`);
  return d("AUTHORIZED_API_SUBMISSION", `Authorised: ${cfg.basis.slice(0, 120)}`);
}

export async function adapterFor(ctx: Ctx, provider: string, boardToken: string | null): Promise<SubmissionAdapter | null> {
  if (ctx.adapters?.[provider]) return ctx.adapters[provider];
  if (provider === "sandbox") return new SandboxAdapter();
  if (provider === "greenhouse" && ctx.env.GREENHOUSE_JOB_BOARD_API_KEY && boardToken) return new GreenhouseAdapter(ctx.env.GREENHOUSE_JOB_BOARD_API_KEY, boardToken, ctx.fetch);
  return null;
}
