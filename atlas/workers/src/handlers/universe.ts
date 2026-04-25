import type { Env } from '../env';
import { json } from '../lib/http';

const SECTOR_META: Record<string, { name: string; ic: string; color: string; desc: string }> = {
  mining:  { name: 'Mining',  ic: '⛏️', color: '#fb923c', desc: 'Gold, silver, copper, lithium, uranium & rare earth miners' },
  ai:      { name: 'AI',      ic: '🤖', color: '#a855f7', desc: 'Artificial intelligence, ML & autonomous systems' },
  tech:    { name: 'Tech',    ic: '💻', color: '#22d3ee', desc: 'Software, cloud, semiconductors & digital infrastructure' },
  biotech: { name: 'Biotech', ic: '🧬', color: '#00e088', desc: 'Biotechnology, pharma, gene therapy & medical innovation' },
  energy:  { name: 'Energy',  ic: '⚡', color: '#ffb020', desc: 'Oil, gas, uranium, renewables & energy infrastructure' },
  defense: { name: 'Defense', ic: '🛡️', color: '#4f8fff', desc: 'Aerospace, defense contractors, military tech & cybersecurity' },
  media:   { name: 'Media',   ic: '📺', color: '#ec4899', desc: 'Streaming, entertainment, social media & digital content' },
  other:   { name: 'Other',   ic: '📊', color: '#6366f1', desc: 'Fintech, infrastructure, consumer & diversified holdings' },
};

export async function handleUniverse(req: Request, env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT ticker, name, exchange, industry, sector, pe, market_cap FROM universe WHERE active = 1 ORDER BY sector, ticker`,
  ).all<{ ticker: string; name: string; exchange: string; industry: string; sector: string; pe: number; market_cap: number }>();

  const sectors: Record<string, { meta: typeof SECTOR_META[string]; stocks: typeof rows.results }> = {};
  for (const r of (rows.results ?? [])) {
    const meta = SECTOR_META[r.sector];
    if (!meta) continue;
    sectors[r.sector] ??= { meta, stocks: [] };
    sectors[r.sector]!.stocks.push(r);
  }
  return json({ sectors }, {
    headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
  }, req, env);
}
