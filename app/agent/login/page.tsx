import { LoginForm } from "@/components/agent/client";
import { authConfig, authDisabled } from "@/lib/agent/auth";

export const dynamic = "force-dynamic";

export default function Login() {
  const cfg = authConfig(process.env);
  return (
    <div className="login">
      <div className="card">
        <h1 style={{ marginBottom: 4 }}>Job Agent</h1>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>Private. Sign in to continue.</p>
        {authDisabled(process.env) ? (
          <div className="notice warn">Auth is disabled for local development (AGENT_AUTH_DISABLED=1). <a href="/agent">Continue</a></div>
        ) : cfg.ok ? (
          <LoginForm />
        ) : (
          <div className="notice bad">
            <b>Not configured.</b> {cfg.reason} Copy <code>.env.example</code> to <code>.env.local</code>, set the values and restart.
          </div>
        )}
      </div>
    </div>
  );
}
