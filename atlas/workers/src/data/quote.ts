import type { Env, Quote } from '../env';

// Quote provider — Polygon preferred (real-time NBBO + last trade), Finnhub fallback (delayed).
// Strategy:
//   1. Try Polygon `/v2/snapshot/locale/us/markets/stocks/tickers/{ticker}` (single + batch supported)
//   2. Fall back to Finnhub `/api/v1/quote?symbol=...` if Polygon unavailable
//   3. KV-cache for 30 s during market hours, 5 min outside

const KV_PREFIX = 'q:';
const TTL_OPEN_MS = 30_000;
const TTL_CLOSED_MS = 300_000;

function isMarketOpen(now = new Date()): boolean {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  const dow = parts.weekday;
  if (dow === 'Sat' || dow === 'Sun') return false;
  const hh = Number(parts.hour);
  const mm = Number(parts.minute);
  const mins = hh * 60 + mm;
  // 09:30–16:00 ET
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

export async function getQuote(env: Env, ticker: string, opts: { force?: boolean } = {}): Promise<Quote | null> {
  const tk = ticker.toUpperCase();
  if (!opts.force) {
    const cached = await env.CACHE.get(`${KV_PREFIX}${tk}`, 'json') as Quote | null;
    if (cached) return { ...cached, source: 'cache' };
  }

  let q = env.POLYGON_API_KEY ? await fetchPolygonQuote(env, tk) : null;
  if (!q && env.FINNHUB_KEY) q = await fetchFinnhubQuote(env, tk);
  if (!q) return null;

  const ttl = isMarketOpen() ? TTL_OPEN_MS : TTL_CLOSED_MS;
  await env.CACHE.put(`${KV_PREFIX}${tk}`, JSON.stringify(q), { expirationTtl: Math.ceil(ttl / 1000) });
  return q;
}

export async function getQuotesBatch(env: Env, tickers: string[]): Promise<Record<string, Quote>> {
  const tks = [...new Set(tickers.map(t => t.toUpperCase()))];
  const out: Record<string, Quote> = {};

  // Read cache hits in parallel
  const cached = await Promise.all(tks.map(tk => env.CACHE.get(`${KV_PREFIX}${tk}`, 'json') as Promise<Quote | null>));
  const misses: string[] = [];
  cached.forEach((c, i) => {
    if (c) out[tks[i]!] = { ...c, source: 'cache' };
    else misses.push(tks[i]!);
  });
  if (!misses.length) return out;

  // Polygon snapshot supports up to ~250 tickers per call → fast batch path
  if (env.POLYGON_API_KEY) {
    const batch = await fetchPolygonBatch(env, misses);
    for (const [tk, q] of Object.entries(batch)) {
      out[tk] = q;
      await env.CACHE.put(`${KV_PREFIX}${tk}`, JSON.stringify(q), {
        expirationTtl: Math.ceil((isMarketOpen() ? TTL_OPEN_MS : TTL_CLOSED_MS) / 1000),
      });
    }
    const stillMissing = misses.filter(t => !out[t]);
    if (!stillMissing.length) return out;
  }

  // Finnhub fallback — must batch in groups of 6 to stay under 60/min
  if (env.FINNHUB_KEY) {
    const stillMissing = misses.filter(t => !out[t]);
    for (let i = 0; i < stillMissing.length; i += 6) {
      const chunk = stillMissing.slice(i, i + 6);
      const results = await Promise.all(chunk.map(tk => fetchFinnhubQuote(env, tk)));
      results.forEach((q, j) => {
        if (q) {
          out[chunk[j]!] = q;
          env.CACHE.put(`${KV_PREFIX}${chunk[j]!}`, JSON.stringify(q), {
            expirationTtl: Math.ceil((isMarketOpen() ? TTL_OPEN_MS : TTL_CLOSED_MS) / 1000),
          }).catch(() => {});
        }
      });
      if (i + 6 < stillMissing.length) await new Promise(r => setTimeout(r, 200));
    }
  }

  return out;
}

// ── Polygon ──────────────────────────────────────────────────────────────
async function fetchPolygonQuote(env: Env, ticker: string): Promise<Quote | null> {
  try {
    const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(ticker)}?apiKey=${env.POLYGON_API_KEY}`;
    const res = await fetch(url, { cf: { cacheTtl: 15 } as any });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const t = data?.ticker;
    if (!t) return null;
    return shapePolygonSnapshot(t);
  } catch { return null; }
}

async function fetchPolygonBatch(env: Env, tickers: string[]): Promise<Record<string, Quote>> {
  const out: Record<string, Quote> = {};
  // Polygon allows comma-list; cap at 250
  for (let i = 0; i < tickers.length; i += 200) {
    const chunk = tickers.slice(i, i + 200);
    const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${chunk.join(',')}&apiKey=${env.POLYGON_API_KEY}`;
    try {
      const res = await fetch(url, { cf: { cacheTtl: 15 } as any });
      if (!res.ok) continue;
      const data = await res.json() as any;
      for (const t of (data?.tickers ?? [])) {
        const q = shapePolygonSnapshot(t);
        if (q) out[t.ticker] = q;
      }
    } catch {}
  }
  return out;
}

function shapePolygonSnapshot(t: any): Quote | null {
  const day = t.day ?? {};
  const prev = t.prevDay ?? {};
  const last = t.lastTrade ?? t.lastQuote ?? {};
  const price = Number(last.p ?? day.c ?? 0);
  const prevClose = Number(prev.c ?? 0);
  if (!price || !prevClose) return null;
  const change = price - prevClose;
  const pct = (change / prevClose) * 100;
  return {
    price,
    prev: prevClose,
    change,
    pct,
    hi: Number(day.h ?? price),
    lo: Number(day.l ?? price),
    open: Number(day.o ?? price),
    volume: Number(day.v ?? 0),
    ts: Date.now(),
    source: 'polygon',
    delayed: false,
  };
}

// ── Finnhub ─────────────────────────────────────────────────────────────
async function fetchFinnhubQuote(env: Env, ticker: string): Promise<Quote | null> {
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${env.FINNHUB_KEY}`;
    const res = await fetch(url, { cf: { cacheTtl: 30 } as any });
    if (!res.ok) return null;
    const q = await res.json() as any;
    if (!q || !(q.c > 0) || !(q.pc > 0)) return null;
    return {
      price: q.c,
      prev: q.pc,
      change: q.d ?? q.c - q.pc,
      pct: q.dp ?? ((q.c - q.pc) / q.pc) * 100,
      hi: q.h ?? q.c,
      lo: q.l ?? q.c,
      open: q.o ?? q.c,
      volume: 0,
      ts: Date.now(),
      source: 'finnhub',
      delayed: true, // Finnhub free tier = 15-min delay
    };
  } catch { return null; }
}
