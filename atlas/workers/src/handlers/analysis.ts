import type { Env } from '../env';
import { authenticate } from '../lib/auth';
import { err, json, todayET } from '../lib/http';
import { analyseTicker, runDailyAnalysis } from '../ai/pipeline';
import { trackRecord } from '../ai/backtest';

export async function handleAnalysis(req: Request, env: Env): Promise<Response> {
  const u = new URL(req.url);
  const date = u.searchParams.get('date') || todayET();
  const ticker = u.searchParams.get('ticker')?.toUpperCase();

  if (ticker) {
    const row = await env.DB.prepare(
      `SELECT * FROM analysis WHERE date = ? AND ticker = ? LIMIT 1`,
    ).bind(date, ticker).first<any>();
    if (!row) return err(404, 'no analysis for ticker on date', req, env);
    return json({
      date,
      ticker: row.ticker,
      sector: row.sector,
      strength: row.strength,
      sentiment: row.sentiment,
      summary: row.summary,
      bulls: JSON.parse(row.bulls_json || '[]'),
      bears: JSON.parse(row.bears_json || '[]'),
      insight: row.insight,
      description: row.description,
      model: row.model,
      createdAt: row.created_at,
    }, {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=600' },
    }, req, env);
  }

  // Full day's analysis + rankings
  const rankings = await env.DB.prepare(`SELECT sector, payload_json FROM rankings WHERE date = ?`).bind(date).all<{ sector: string; payload_json: string }>();
  const stocks = await env.DB.prepare(
    `SELECT ticker, sector, strength, sentiment, summary, bulls_json, bears_json, insight, description FROM analysis WHERE date = ?`,
  ).bind(date).all<any>();

  const stocksMap: Record<string, unknown> = {};
  for (const s of (stocks.results ?? [])) {
    stocksMap[s.ticker] = {
      ticker: s.ticker, sector: s.sector,
      strength: s.strength, sentiment: s.sentiment,
      summary: s.summary,
      bulls: JSON.parse(s.bulls_json || '[]'),
      bears: JSON.parse(s.bears_json || '[]'),
      insight: s.insight,
      description: s.description,
    };
  }

  const rankingsMap: Record<string, unknown> = {};
  for (const r of (rankings.results ?? [])) {
    try { rankingsMap[r.sector] = { featured: JSON.parse(r.payload_json) }; } catch {}
  }

  return json({ date, stocks: stocksMap, rankings: rankingsMap }, {
    headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=600' },
  }, req, env);
}

export async function handleRunAnalysis(req: Request, env: Env): Promise<Response> {
  const ctx = await authenticate(req, env);
  if (!ctx) return err(401, 'auth required', req, env);
  if (ctx.user.role !== 'admin' && ctx.user.role !== 'analyst') return err(403, 'admin/analyst only', req, env);

  const u = new URL(req.url);
  const ticker = u.searchParams.get('ticker')?.toUpperCase();
  if (ticker) {
    const r = await analyseTicker(env, ticker);
    if (!r) return err(500, 'analysis failed', req, env);
    return json({ ok: true, result: r }, {}, req, env);
  }
  const summary = await runDailyAnalysis(env);
  return json({ ok: true, ...summary }, {}, req, env);
}

export async function handleTrackRecord(req: Request, env: Env): Promise<Response> {
  const u = new URL(req.url);
  const days = Math.max(1, Math.min(180, Number(u.searchParams.get('days') || 30)));
  const stats = await trackRecord(env, days);
  return json({ days, stats }, {
    headers: { 'Cache-Control': 'public, max-age=600' },
  }, req, env);
}
