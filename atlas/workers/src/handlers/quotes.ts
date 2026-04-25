import type { Env } from '../env';
import { err, json } from '../lib/http';
import { getQuote, getQuotesBatch } from '../data/quote';

export async function handleQuote(req: Request, env: Env): Promise<Response> {
  const u = new URL(req.url);
  const ticker = u.searchParams.get('t')?.toUpperCase();
  if (!ticker) return err(400, 'ticker required', req, env);
  const q = await getQuote(env, ticker);
  if (!q) return err(404, 'no quote', req, env);
  return json({ ticker, quote: q }, {
    headers: { 'Cache-Control': 'public, max-age=15, stale-while-revalidate=60' },
  }, req, env);
}

export async function handleQuotesBatch(req: Request, env: Env): Promise<Response> {
  const u = new URL(req.url);
  const param = u.searchParams.get('t');
  let tickers: string[];
  if (param) {
    tickers = param.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 200);
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
