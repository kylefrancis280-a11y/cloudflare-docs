import type { Env, NewsItem, AnalystRecs } from '../env';
import { sanitizeNewsItem } from '../lib/http';

const KV_NEWS_PREFIX = 'n:';
const KV_RECS_PREFIX = 'r:';
const TTL_NEWS_SEC = 1800;
const TTL_RECS_SEC = 21600;

const POSITIVE = /\b(beats?|surges?|rallies|raised?|record|upgrade|outperform|breakthrough|approval|profit|expand|launch|wins?|partnership)\b/i;
const NEGATIVE = /\b(misses?|falls?|drops?|cuts?|warning|downgrade|layoff|loss|recall|investigation|delays?|guidance\s+cut|halts?|risk)\b/i;

function classify(headline: string): 'positive' | 'negative' | 'neutral' {
  if (POSITIVE.test(headline)) return 'positive';
  if (NEGATIVE.test(headline)) return 'negative';
  return 'neutral';
}

export async function getNews(env: Env, ticker: string, limit = 6): Promise<NewsItem[]> {
  const tk = ticker.toUpperCase();
  const cached = await env.CACHE.get(`${KV_NEWS_PREFIX}${tk}`, 'json') as NewsItem[] | null;
  if (cached) return cached.slice(0, limit);

  let items: NewsItem[] = [];
  if (env.POLYGON_API_KEY) items = await fetchPolygonNews(env, tk, limit);
  if (!items.length && env.FINNHUB_KEY) items = await fetchFinnhubNews(env, tk, limit);
  if (!items.length) return [];

  await env.CACHE.put(`${KV_NEWS_PREFIX}${tk}`, JSON.stringify(items), { expirationTtl: TTL_NEWS_SEC });
  return items.slice(0, limit);
}

export async function getRecs(env: Env, ticker: string): Promise<AnalystRecs | null> {
  const tk = ticker.toUpperCase();
  const cached = await env.CACHE.get(`${KV_RECS_PREFIX}${tk}`, 'json') as AnalystRecs | null;
  if (cached) return cached;

  let r: AnalystRecs | null = null;
  if (env.FINNHUB_KEY) r = await fetchFinnhubRecs(env, tk);
  if (!r) return null;
  await env.CACHE.put(`${KV_RECS_PREFIX}${tk}`, JSON.stringify(r), { expirationTtl: TTL_RECS_SEC });
  return r;
}

async function fetchPolygonNews(env: Env, ticker: string, limit: number): Promise<NewsItem[]> {
  try {
    const url = `https://api.polygon.io/v2/reference/news?ticker=${encodeURIComponent(ticker)}&limit=${limit}&order=desc&apiKey=${env.POLYGON_API_KEY}`;
    const res = await fetch(url, { cf: { cacheTtl: 600 } as any });
    if (!res.ok) return [];
    const data = await res.json() as any;
    return (data?.results ?? []).slice(0, limit).map((n: any) => sanitizeNewsItem({
      headline: n.title ?? '',
      source: n.publisher?.name ?? n.author ?? 'Unknown',
      url: n.article_url ?? '',
      ts: n.published_utc ? new Date(n.published_utc).getTime() : Date.now(),
      sentiment: classify(n.title ?? ''),
    }));
  } catch { return []; }
}

async function fetchFinnhubNews(env: Env, ticker: string, limit: number): Promise<NewsItem[]> {
  try {
    const today = new Date();
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const fmt = (d: Date) => d.toISOString().split('T')[0];
    const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(ticker)}&from=${fmt(weekAgo)}&to=${fmt(today)}&token=${env.FINNHUB_KEY}`;
    const res = await fetch(url, { cf: { cacheTtl: 600 } as any });
    if (!res.ok) return [];
    const arr = await res.json() as any[];
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, limit).map((n: any) => sanitizeNewsItem({
      headline: n.headline ?? '',
      source: n.source ?? 'Unknown',
      url: n.url ?? '',
      ts: n.datetime ? n.datetime * 1000 : Date.now(),
      sentiment: classify(n.headline ?? ''),
    }));
  } catch { return []; }
}

async function fetchFinnhubRecs(env: Env, ticker: string): Promise<AnalystRecs | null> {
  try {
    const url = `https://finnhub.io/api/v1/stock/recommendation?symbol=${encodeURIComponent(ticker)}&token=${env.FINNHUB_KEY}`;
    const res = await fetch(url, { cf: { cacheTtl: 21600 } as any });
    if (!res.ok) return null;
    const arr = await res.json() as any[];
    if (!Array.isArray(arr) || !arr.length) return null;
    const l = arr[0];
    return {
      buy: (l.buy ?? 0) + (l.strongBuy ?? 0),
      hold: l.hold ?? 0,
      sell: (l.sell ?? 0) + (l.strongSell ?? 0),
      strongBuy: l.strongBuy ?? 0,
      strongSell: l.strongSell ?? 0,
      total: (l.buy ?? 0) + (l.strongBuy ?? 0) + (l.hold ?? 0) + (l.sell ?? 0) + (l.strongSell ?? 0),
    };
  } catch { return null; }
}
