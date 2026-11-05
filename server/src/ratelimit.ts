import type { Context, MiddlewareHandler } from "hono";

/** Sliding-window limiter: true if `key` may proceed (docs/interfaces.md section 10: 30/min per device and per IP). */
export function createRateLimiter(limit = 30, windowMs = 60_000, clock: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const now = clock();
    const recent = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
    const allowed = recent.length < limit;
    if (allowed) recent.push(now);
    hits.set(key, recent);
    return allowed;
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;

/** Client IP as seen through the cloudflared tunnel, else the forwarding chain. */
export function clientIp(c: Context): string {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

export function ipRateLimit(limiter: RateLimiter): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method !== "GET" && !limiter(`ip:${clientIp(c)}`)) return c.json({ error: "rate limit: 30 requests per minute" }, 429);
    await next();
  };
}
