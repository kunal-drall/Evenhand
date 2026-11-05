import { timingSafeEqual } from "node:crypto";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, MiddlewareHandler } from "hono";

/** Sliding-window limiter: true if `key` may proceed (docs/interfaces.md section 10: 30/min per device and per IP). */
export function createRateLimiter(limit = 30, windowMs = 60_000, clock: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return (key: string, max = limit): boolean => {
    const now = clock();
    if (hits.size > 10_000) {
      for (const [k, times] of hits) if (!times.some((t) => t > now - windowMs)) hits.delete(k);
    }
    const recent = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
    const allowed = recent.length < max;
    if (allowed) recent.push(now);
    hits.set(key, recent);
    return allowed;
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * Client IP. Forwarding headers are trusted only when the socket peer is loopback (cloudflared on the same
 * machine); anything else uses the socket address, so a direct client cannot spoof its way past the limit.
 */
export function clientIp(c: Context): string {
  let peer: string | undefined;
  try {
    peer = getConnInfo(c).remote.address;
  } catch {
    peer = undefined; // in-process requests (tests)
  }
  if (peer && !LOOPBACK.has(peer)) return peer;
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? peer ?? "local";
}

/** 30 writes per minute per IP; reads get a looser 240 (pages poll). */
export function ipRateLimit(limiter: RateLimiter): MiddlewareHandler {
  return async (c, next) => {
    const write = c.req.method !== "GET";
    if (!limiter(`${write ? "ip" : "ip-read"}:${clientIp(c)}`, write ? 30 : 240)) {
      return c.json({ error: "rate limit exceeded, try again in a minute" }, 429);
    }
    await next();
  };
}

/**
 * Operator endpoints (rental listings, CSV export, arbiter queue) need OPERATOR_TOKEN as `x-operator-token`
 * or `?token=`. Without OPERATOR_TOKEN configured they are open (local development only).
 */
export function operatorOnly(token: string | undefined): MiddlewareHandler {
  return async (c, next) => {
    if (token) {
      const given = Buffer.from(c.req.header("x-operator-token") ?? c.req.query("token") ?? "");
      const expected = Buffer.from(token);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return c.json({ error: "operator token required" }, 401);
    }
    await next();
  };
}
