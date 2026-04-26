import type { Env } from '../env';

// Sliding-window rate limiter backed by D1.
// Use for: login attempts (5/15min/IP+email), signup (3/hour/IP), password reset (3/hour/email).
export interface RateLimitOptions {
  key: string;
  max: number;
  windowMs: number;
}

export async function rateLimit(env: Env, opts: RateLimitOptions): Promise<{ ok: boolean; retryAfterSec: number }> {
  const now = Date.now();
  const windowStart = now - opts.windowMs;

  // Best-effort cleanup
  env.DB.prepare(`DELETE FROM rate_limit WHERE expires_at < ?`)
    .bind(new Date(now).toISOString()).run().catch(() => {});

  const row = await env.DB.prepare(
    `SELECT count, window_start FROM rate_limit WHERE key = ? LIMIT 1`,
  ).bind(opts.key).first<{ count: number; window_start: string }>();

  if (!row) {
    await env.DB.prepare(
      `INSERT INTO rate_limit (key, count, window_start, expires_at) VALUES (?, 1, ?, ?)`,
    ).bind(
      opts.key,
      new Date(now).toISOString(),
      new Date(now + opts.windowMs).toISOString(),
    ).run();
    return { ok: true, retryAfterSec: 0 };
  }

  const ws = new Date(row.window_start).getTime();
  if (ws < windowStart) {
    // Reset window
    await env.DB.prepare(
      `UPDATE rate_limit SET count = 1, window_start = ?, expires_at = ? WHERE key = ?`,
    ).bind(
      new Date(now).toISOString(),
      new Date(now + opts.windowMs).toISOString(),
      opts.key,
    ).run();
    return { ok: true, retryAfterSec: 0 };
  }

  if (row.count >= opts.max) {
    const retryAfterSec = Math.ceil((ws + opts.windowMs - now) / 1000);
    return { ok: false, retryAfterSec: Math.max(retryAfterSec, 1) };
  }

  await env.DB.prepare(`UPDATE rate_limit SET count = count + 1 WHERE key = ?`).bind(opts.key).run();
  return { ok: true, retryAfterSec: 0 };
}
