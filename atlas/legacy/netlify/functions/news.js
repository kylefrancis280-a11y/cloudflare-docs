// news.js - Fetches news + analyst recs from Finnhub (server-side)
// Cached in Firebase for 30 minutes to stay fast
const DB = 'https://atlas-intelligence-37d6d-default-rtdb.firebaseio.com';
const SECRET = process.env.FIREBASE_DB_SECRET;
const FH_KEY = process.env.FINNHUB_KEY;

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

const TICKERS = [
  'ABX','TECK','WPM','NEM','FCX','AEM','RIO','BHP','VALE',
  'PLTR','AI','PATH','SOUN','BBAI','BB','SNOW','CRWD','DDOG',
  'OTEX','GDDY','SHOP','ANET','CSU','TSM',
  'MRNA','CRSP','BNTX','ABCL','VRTX','RXRX',
  'SU','CCJ','CNQ','ENB','XOM','FSLR','CVX','COP','NEE',
  'GD','RTX','CAE','LMT','AXON','NOC','HII','LHX',
  'DIS','NFLX','SPOT','WBD','PARA','ROKU',
  'V','SQ','CNR','WM','COST','BAM'
];

function cors(code, body) {
  return {
    statusCode: code,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300'
    },
    body: JSON.stringify(body)
  };
}

async function fbGet(path) {
  const res = await fetch(`${DB}/${path}.json?auth=${SECRET}`);
  return res.ok ? await res.json() : null;
}

async function fbPut(path, data) {
  await fetch(`${DB}/${path}.json?auth=${SECRET}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return cors(200, {});

  if (!SECRET || !FH_KEY) return cors(500, { error: 'Missing required secrets' });

  try {
    // Check cache first
    const cached = await fbGet('news_cache');
    if (cached && cached.ts && (Date.now() - cached.ts < CACHE_TTL)) {
      return cors(200, { ...cached, cached: true });
    }

    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().split('T')[0];

    const news = {};
    const recs = {};

    // Parallel fetch for speed
    await Promise.allSettled([
      ...TICKERS.map(async tk => {
        try {
          const res = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${tk}&from=${weekAgo}&to=${today}&token=${FH_KEY}`);
          if (!res.ok) return;
          const articles = await res.json();
          if (Array.isArray(articles) && articles.length) {
            news[tk] = articles.slice(0, 6).map(n => ({
              headline: n.headline || '',
              source: n.source || 'Unknown',
              url: n.url || '',
              time: n.datetime ? new Date(n.datetime * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '',
              sentiment: n.headline ? (n.headline.match(/beat|surge|up|grow|strong|profit|raise|record|buy|upgrade/i) ? 'positive' : n.headline.match(/miss|down|fall|loss|cut|weak|sell|downgrade|risk|warn/i) ? 'negative' : 'neutral') : 'neutral'
            }));
          }
        } catch (e) {}
      }),

      ...TICKERS.map(async tk => {
        try {
          const res = await fetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${tk}&token=${FH_KEY}`);
          if (!res.ok) return;
          const list = await res.json();
          if (Array.isArray(list) && list.length) {
            const l = list[0];
            recs[tk] = {
              buy: (l.buy || 0) + (l.strongBuy || 0),
              hold: l.hold || 0,
              sell: (l.sell || 0) + (l.strongSell || 0),
              total: (l.buy || 0) + (l.strongBuy || 0) + (l.hold || 0) + (l.sell || 0) + (l.strongSell || 0)
            };
          }
        } catch (e) {}
      })
    ]);

    const cacheData = {
      news,
      recs,
      ts: Date.now(),
      newsCount: Object.keys(news).length,
      recsCount: Object.keys(recs).length
    };

    // Save cache if we got real data
    if (Object.keys(news).length > 5 || Object.keys(recs).length > 5) {
      await fbPut('news_cache', cacheData);
    }

    return cors(200, cacheData);

  } catch (e) {
    console.error(e);
    // Fallback to cache if available
    try {
      const cached = await fbGet('news_cache');
      if (cached) return cors(200, { ...cached, stale: true });
    } catch {}
    return cors(500, { error: e.message });
  }
};
