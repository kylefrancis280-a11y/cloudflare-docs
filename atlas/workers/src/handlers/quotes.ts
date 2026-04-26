import type { Env } from '../env';
import { err, json, clientIp } from '../lib/http';
import { rateLimit } from '../lib/rate';
import { getQuote, getQuotesBatch } from '../data/quote';

const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/;

export async function handleQuote(req: Request, env: Env): Promise<Response> {
  const ip = clientIp(req);
  const rl = await rateLimit(env, { key: `quote:${ip}`, max: 120, windowMs: 60_000 });
  if (!rl.ok) return err(429, 'rate limit exceeded', req, env, { retryAfter: rl.retryAfterSec });

  const u = new URL(req.url);
  const ticker = u.searchParams.get('t')?.toUpperCase();
  if (!ticker) return err(400, 'ticker required', req, env);
  if (!TICKER_RE.test(ticker)) return err(400, 'invalid ticker format', req, env);
  const q = await getQuote(env, ticker);
  if (!q) return err(404, 'no quote', req, env);
  return json({ ticker, quote: q }, {
    headers: { 'Cache-Control': 'public, max-age=15, stale-while-revalidate=60' },
  }, req, env);
}

export async function handleQuotesBatch(req: Request, env: Env): Promise<Response> {
  const ip = clientIp(req);
  const rl = await rateLimit(env, { key: `quotes:${ip}`, max: 60, windowMs: 60_000 });
  if (!rl.ok) return err(429, 'rate limit exceeded', req, env, { retryAfter: rl.retryAfterSec });

  const u = new URL(req.url);
  const param = u.searchParams.get('t');
  let tickers: string[];
  if (param) {
    tickers = param.split(',').map(s => s.trim().toUpperCase()).filter(s => TICKER_RE.test(s)).slice(0, 200);
  } else {
    // Default to today's featured (from rankings) — falls back to entire active universe
    const today = new Date().toISOString().split('T')[0];
    const rows = await env.DB.prepare(
      `SELECT payload_json FROM rankings WHERE date = ?`,
    ).bind(today).all<{ payload_json: string }>();
    const set = new Set<string>();
    for (const r of (rows.results ?? [])) {
      try { (JSON.parse(r.payload_json) as Array<{ ticker: string }>).forEach(f => set.add(f.ticker)); } catch {}
    }
    if (!set.size) {
      const all = await env.DB.prepare(`SELECT ticker FROM universe WHERE active = 1 LIMIT 60`).all<{ ticker: string }>();
      (all.results ?? []).forEach(r => set.add(r.ticker));
    }
    tickers = [...set];
  }
  const quotes = await getQuotesBatch(env, tickers);
  return json({ quotes, ts: Date.now(), count: Object.keys(quotes).length }, {
    headers: { 'Cache-Control': 'public, max-age=15, stale-while-revalidate=60' },
  }, req, env);
}
