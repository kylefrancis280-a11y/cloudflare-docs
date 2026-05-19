/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../env';

// Sliding-window rate limiter backed by D1
// Used for: login attempts, signups, password resets, etc.
export interface RateLimitOptions {
  key: string;        // unique key (e.g. "login:ip:email")
  max: number;        // max attempts
  windowMs: number;   // time window in milliseconds
}

export async function rateLimit(env: Env, opts: RateLimitOptions): Promise<{
  ok: boolean;
  retryAfterSec: number;
}> {
  const now = Date.now();
  const windowStart = now - opts.windowMs;

  // Best-effort cleanup of expired records
  env.DB.prepare(`DELETE FROM rate_limit WHERE expires_at < ?`)
    .bind(new Date(now).toISOString())
    .run()
    .catch(() => {});

  const row = await env.DB.prepare(
    `SELECT count, window_start FROM rate_limit WHERE key = ? LIMIT 1`
  ).bind(opts.key).first<{ count: number; window_start: string }>();

  if (!row) {
    // First request in this window
    await env.DB.prepare(
      `INSERT INTO rate_limit (key, count, window_start, expires_at) VALUES (?, 1, ?, ?)`
    ).bind(
      opts.key,
      new Date(now).toISOString(),
      new Date(now + opts.windowMs).toISOString()
    ).run();

    return { ok: true, retryAfterSec: 0 };
  }

  const ws = new Date(row.window_start).getTime();

  if (ws < windowStart) {
    // Window expired → reset
    await env.DB.prepare(
      `UPDATE rate_limit SET count = 1, window_start = ?, expires_at = ? WHERE key = ?`
    ).bind(
      new Date(now).toISOString(),
      new Date(now + opts.windowMs).toISOString(),
      opts.key
    ).run();

    return { ok: true, retryAfterSec: 0 };
  }

  if (row.count >= opts.max) {
    const retryAfterSec = Math.ceil((ws + opts.windowMs - now) / 1000);
    return { ok: false, retryAfterSec: Math.max(retryAfterSec, 1) };
  }

  // Increment count
  await env.DB.prepare(`UPDATE rate_limit SET count = count + 1 WHERE key = ?`)
    .bind(opts.key)
    .run();

  return { ok: true, retryAfterSec: 0 };
}
