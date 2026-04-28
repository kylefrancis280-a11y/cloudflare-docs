// Fetches prices for TODAY'S featured stocks from Firebase rankings.
// Dynamic — only fetches tickers the AI selected today.
// Falls back to a default set if no rankings exist yet.
// Cache TTL = 60 seconds → stays under Finnhub's 60/min limit.

const DB = 'https://atlas-intelligence-37d6d-default-rtdb.firebaseio.com';
const SECRET = process.env.FIREBASE_DB_SECRET;
const FH_KEY = process.env.FINNHUB_KEY;
const CACHE_TTL = 60000;

// Fallback tickers if no AI rankings exist yet
const DEFAULT_TICKERS = [
  'ABX','TECK','WPM','NEM','FCX','AEM','RIO','BHP','VALE',
  'PLTR','AI','PATH','SOUN','BBAI','BB','SNOW','CRWD','DDOG',
  'OTEX','GDDY','SHOP','ANET','CSU','TSM',
  'MRNA','CRSP','BNTX','ABCL','VRTX','RXRX',
  'SU','CCJ','CNQ','ENB','XOM','FSLR','CVX','COP','NEE',
  'GD','RTX','CAE','LMT','AXON','NOC','HII','LHX',
  'DIS','NFLX','SPOT','WBD','PARA','ROKU',
  'V','SQ','CNR','WM','COST','BAM'
];

async function fbGet(path) {
  const res = await fetch(`${DB}/${path}.json?auth=${SECRET}`);
  return res.ok ? await res.json() : null;
}
async function fbPut(path, data) {
  await fetch(`${DB}/${path}.json?auth=${SECRET}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  });
}

function cors(code, body) {
  return {
    statusCode: code,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=10' },
    body: JSON.stringify(body)
  };
}

async function getTodaysTickers() {
  try {
    const today = new Date().toISOString().split('T')[0];
    const rankings = await fbGet(`daily_analysis/${today}/rankings`);
    if (!rankings) return DEFAULT_TICKERS;
    
    const tickers = new Set();
    Object.values(rankings).forEach(sector => {
      if (sector.featured) {
        sector.featured.forEach(f => tickers.add(f.ticker));
      }
    });
    
    return tickers.size > 0 ? [...tickers] : DEFAULT_TICKERS;
  } catch (e) {
    return DEFAULT_TICKERS;
  }
}

async function fetchFinnhubPrices(tickers) {
  const prices = {};
  for (let i = 0; i < tickers.length; i += 6) {
    const batch = tickers.slice(i, i + 6);
    await Promise.allSettled(
      batch.map(async tk => {
        try {
          const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${tk}&token=${FH_KEY}`);
          if (!res.ok) return;
          const q = await res.json();
          if (q && q.c > 0 && q.pc > 0) {
            prices[tk] = { price: q.c, prev: q.pc, change: q.d || 0, pct: q.dp || 0, hi: q.h || q.c, lo: q.l || q.c, vol: 0 };
          }
        } catch (e) {}
      })
    );
    if (i + 6 < tickers.length) await new Promise(r => setTimeout(r, 200));
  }
  return prices;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return cors(200, {});
  if (!SECRET) return cors(500, { error: 'Set FIREBASE_DB_SECRET env var' });
  
  try {
    const cached = await fbGet('price_cache');
    if (cached && cached.ts && (Date.now() - cached.ts < CACHE_TTL)) {
      return cors(200, { prices: cached.prices, ts: cached.ts, cached: true, count: Object.keys(cached.prices).length });
    }
    
    // Get today's AI-selected tickers
    const tickers = await getTodaysTickers();
    const prices = await fetchFinnhubPrices(tickers);
    const count = Object.keys(prices).length;
    
    if (count > 0) {
      const cacheData = { prices, ts: Date.now(), count };
      await fbPut('price_cache', cacheData);
      return cors(200, { ...cacheData, cached: false });
    }
    
    if (cached && cached.prices) {
      return cors(200, { prices: cached.prices, ts: cached.ts, cached: true, stale: true, count: Object.keys(cached.prices).length });
    }
    
    return cors(500, { error: 'No price data available' });
  } catch (e) {
    console.error('Price error:', e);
    try {
      const cached = await fbGet('price_cache');
      if (cached?.prices) return cors(200, { prices: cached.prices, ts: cached.ts, cached: true, stale: true });
    } catch (e2) {}
    return cors(500, { error: e.message });
  }
};
