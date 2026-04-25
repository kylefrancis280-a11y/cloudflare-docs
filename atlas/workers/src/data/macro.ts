import type { Env } from '../env';

// Macro context for the analysis prompt: a small, slow-moving snapshot of the
// macro regime. Pulled from FRED + a couple of Treasury yields. Cached 1h in KV.
export interface MacroSnapshot {
  asOf: string;
  cpiYoY: number | null;
  unemploymentRate: number | null;
  fedFundsTarget: number | null;
  treasury10y: number | null;
  treasury2y: number | null;
  yieldCurveSpread: number | null;
  vix: number | null;
}

const KEY = 'macro:current';
const TTL_SEC = 3600;

export async function getMacro(env: Env): Promise<MacroSnapshot | null> {
  const cached = await env.CACHE.get(KEY, 'json') as MacroSnapshot | null;
  if (cached) return cached;

  if (!env.FRED_API_KEY) return null;
  const series = ['CPIAUCSL', 'UNRATE', 'DFEDTARU', 'DGS10', 'DGS2', 'VIXCLS'] as const;
  const fetched = await Promise.all(series.map(s => fetchFredLatest(env, s)));
  const m: MacroSnapshot = {
    asOf: new Date().toISOString(),
    cpiYoY: yearOverYear(fetched[0]),
    unemploymentRate: latestValue(fetched[1]),
    fedFundsTarget: latestValue(fetched[2]),
    treasury10y: latestValue(fetched[3]),
    treasury2y: latestValue(fetched[4]),
    yieldCurveSpread: null,
    vix: latestValue(fetched[5]),
  };
  if (m.treasury10y != null && m.treasury2y != null) {
    m.yieldCurveSpread = +(m.treasury10y - m.treasury2y).toFixed(2);
  }
  await env.CACHE.put(KEY, JSON.stringify(m), { expirationTtl: TTL_SEC });
  return m;
}

async function fetchFredLatest(env: Env, seriesId: string): Promise<{ date: string; value: number }[]> {
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${env.FRED_API_KEY}&file_type=json&sort_order=desc&limit=14`;
    const res = await fetch(url, { cf: { cacheTtl: 3600 } as any });
    if (!res.ok) return [];
    const data = await res.json() as any;
    return (data?.observations ?? [])
      .filter((o: any) => o.value !== '.')
      .map((o: any) => ({ date: o.date, value: Number(o.value) }))
      .filter((o: { value: number }) => Number.isFinite(o.value));
  } catch { return []; }
}

function latestValue(obs: { date: string; value: number }[]): number | null {
  return obs.length ? obs[0]!.value : null;
}

function yearOverYear(obs: { date: string; value: number }[]): number | null {
  if (obs.length < 13) return null;
  const latest = obs[0]!.value;
  const yearAgo = obs[12]!.value;
  if (!yearAgo) return null;
  return +(((latest - yearAgo) / yearAgo) * 100).toFixed(2);
}

// SEC EDGAR — most-recent filing summary for a ticker. Free, no key needed.
// Used by the analysis pipeline to add filing-aware context to Claude prompts.
export interface RecentFiling {
  form: string;
  filingDate: string;
  reportDate: string;
  primaryDocument: string;
  description: string;
}

export async function getRecentFilings(ticker: string, limit = 4): Promise<RecentFiling[]> {
  try {
    const lookup = await fetch(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(ticker)}&type=10-K&dateb=&owner=include&count=10&output=atom`, {
      headers: { 'User-Agent': 'Atlas Analysis research@atlasanalysis.net', 'Accept': 'application/atom+xml' },
    });
    if (!lookup.ok) return [];
    const text = await lookup.text();
    const cikMatch = text.match(/CIK=(\d+)/);
    if (!cikMatch) return [];
    const cik = cikMatch[1]!.padStart(10, '0');

    const subs = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: { 'User-Agent': 'Atlas Analysis research@atlasanalysis.net' },
    });
    if (!subs.ok) return [];
    const data = await subs.json() as any;
    const recent = data?.filings?.recent;
    if (!recent) return [];
    const out: RecentFiling[] = [];
    for (let i = 0; i < (recent.form?.length ?? 0) && out.length < limit; i++) {
      const form = recent.form[i] as string;
      if (!['10-K', '10-Q', '8-K'].includes(form)) continue;
      out.push({
        form,
        filingDate: recent.filingDate[i],
        reportDate: recent.reportDate?.[i] ?? recent.filingDate[i],
        primaryDocument: recent.primaryDocument[i],
        description: recent.primaryDocDescription?.[i] ?? '',
      });
    }
    return out;
  } catch { return []; }
}
