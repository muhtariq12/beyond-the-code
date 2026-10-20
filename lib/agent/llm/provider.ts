import type { ZodType } from "zod";
import { redactSecrets } from "./safety";

export class LlmUnavailable extends Error {}

export interface JsonRequest<T> {
  system: string;
  user: string;
  schema: ZodType<T>;
  maxTokens?: number;
}

/**
 * Provider-agnostic, text-in / validated-JSON-out. Deliberately has no tools: a model can
 * never run commands, touch the database, make network requests or submit applications.
 */
export interface LlmProvider {
  readonly name: string;
  readonly available: boolean;
  completeJson<T>(req: JsonRequest<T>): Promise<T>;
}

export class NullProvider implements LlmProvider {
  readonly name = "none";
  readonly available = false;
  async completeJson<T>(): Promise<T> {
    throw new LlmUnavailable("No LLM provider configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY).");
  }
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Model returned no JSON object");
  return JSON.parse(body.slice(start, end + 1));
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

abstract class HttpProvider implements LlmProvider {
  readonly available = true;
  abstract readonly name: string;
  constructor(protected fetchFn: Fetch) {}
  protected abstract call(req: JsonRequest<unknown>): Promise<string>;
  async completeJson<T>(req: JsonRequest<T>): Promise<T> {
    let raw: string;
    try {
      raw = await this.call(req as JsonRequest<unknown>);
    } catch (e) {
      throw new Error(redactSecrets(`LLM request failed: ${(e as Error).message}`));
    }
    return req.schema.parse(extractJson(raw));
  }
}

export class AnthropicProvider extends HttpProvider {
  readonly name = "anthropic";
  constructor(private apiKey: string, private model: string, fetchFn: Fetch = fetch) {
    super(fetchFn);
  }
  protected async call(req: JsonRequest<unknown>): Promise<string> {
    const res = await this.fetchFn("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens ?? 4000,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    return (data.content ?? []).map((c) => c.text ?? "").join("");
  }
}

export class OpenAiCompatibleProvider extends HttpProvider {
  readonly name = "openai-compatible";
  constructor(private apiKey: string, private model: string, private baseUrl = "https://api.openai.com/v1", fetchFn: Fetch = fetch) {
    super(fetchFn);
  }
  protected async call(req: JsonRequest<unknown>): Promise<string> {
    const res = await this.fetchFn(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens ?? 4000,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? "";
  }
}

export function providerFromEnv(env: Record<string, string | undefined>): LlmProvider {
  if (env.ANTHROPIC_API_KEY) return new AnthropicProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL || "claude-sonnet-5-5");
  if (env.OPENAI_API_KEY) return new OpenAiCompatibleProvider(env.OPENAI_API_KEY, env.OPENAI_MODEL || "gpt-4o", env.OPENAI_BASE_URL || undefined);
  return new NullProvider();
}
