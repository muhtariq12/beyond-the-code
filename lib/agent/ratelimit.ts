interface Bucket {
  hits: number[];
}

/** In-memory sliding-window limiter, adequate for a single-owner deployment. Use an edge/KV limiter if scaled out. */
export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(private now: () => number = Date.now) {}

  check(key: string, max: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
    const t = this.now();
    const b = this.buckets.get(key) ?? { hits: [] };
    b.hits = b.hits.filter((h) => t - h < windowMs);
    if (b.hits.length >= max) {
      this.buckets.set(key, b);
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.hits[0] + windowMs - t) / 1000)) };
    }
    b.hits.push(t);
    this.buckets.set(key, b);
    if (this.buckets.size > 5000) for (const [k, v] of this.buckets) if (v.hits.every((h) => t - h >= windowMs)) this.buckets.delete(k);
    return { ok: true, retryAfterSec: 0 };
  }
}

export const limiter = new RateLimiter();
