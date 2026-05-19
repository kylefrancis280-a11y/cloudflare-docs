// Atlas Daily Analysis Engine v2 - GROK ONLY
const DB = 'https://atlas-intelligence-37d6d-default-rtdb.firebaseio.com';
const SECRET = process.env.FIREBASE_DB_SECRET;
const FH_KEY = process.env.FINNHUB_KEY;
const GROK_KEY = process.env.GROK_API_KEY;   // ← your xAI key

function cors(c, b) {
  return {
    statusCode: c,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(b)
  };
}

async function fbGet(p) {
  const r = await fetch(`${DB}/${p}.json?auth=${SECRET}`);
  return r.ok ? await r.json() : null;
}

async function fbPut(p, d) {
  await fetch(`${DB}/${p}.json?auth=${SECRET}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(d)
  });
}

async function fbPatch(p, d) {
  await fetch(`${DB}/${p}.json?auth=${SECRET}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(d)
  });
}

async function quote(tk) {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${tk}&token=${FH_KEY}`);
    if (!r.ok) return null;
    const q = await r.json();
    return q?.c > 0 ? { price: q.c, change: q.d, pct: q.dp, hi: q.h, lo: q.l, prev: q.pc } : null;
  } catch(e) { return null; }
}

async function news(tk) {
  try {
    const to = new Date().toISOString().split('T')[0];
    const fr = new Date(Date.now() - 7 * 864e5).toISOString().split('T')[0];
    const r = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${tk}&from=${fr}&to=${to}&token=${FH_KEY}`);
    if (!r.ok) return [];
    const a = await r.json();
    return Array.isArray(a) ? a.slice(0, 4).map(n => ({ hl: n.headline, src: n.source, url: n.url })) : [];
  } catch(e) { return []; }
}

async function recs(tk) {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${tk}&token=${FH_KEY}`);
    if (!r.ok) return null;
    const a = await r.json();
    if (!Array.isArray(a) || !a.length) return null;
    const l = a[0];
    return {
      buy: (l.buy || 0) + (l.strongBuy || 0),
      hold: l.hold || 0,
      sell: (l.sell || 0) + (l.strongSell || 0),
      total: (l.buy || 0) + (l.strongBuy || 0) + (l.hold || 0) + (l.sell || 0) + (l.strongSell || 0)
    };
  } catch(e) { return null; }
}

// GROK CALL - Replaces old Claude function
async function grokAnalyze(tk, sector, qt, nw, rc) {
  const ns = nw.length ? nw.map(n => `- ${n.hl} (${n.src})`).join('\n') : 'No major headlines.';
  const rs = rc ? `Analysts: ${rc.buy} Buy, ${rc.hold} Hold, ${rc.sell} Sell (${rc.total} total).` : '';

  const prompt = `You are a senior equity analyst at Atlas Analysis.
Research note for ${tk} (${sector}).

DATA:
Price $${qt.price.toFixed(2)} (${qt.pct >= 0 ? '+' : ''}${qt.pct.toFixed(2)}%)
Range $${qt.lo.toFixed(2)} - $${qt.hi.toFixed(2)}
Prev $${qt.prev.toFixed(2)}
${rs}

NEWS:
${ns}

Reply **ONLY** valid JSON:
{
  "summary": "2-3 sentence research note referencing the data",
  "sentiment": "Strongly Bullish|Bullish|Neutral|Cautious|Bearish",
  "bulls": ["3 bullish factors"],
  "bears": ["2 risk factors"],
  "insight": "key takeaway",
  "description": "1 sentence company description"
}`;

  try {
    const r = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROK_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "grok-3",
        max_tokens: 600,
        temperature: 0.7,
        messages: [
          { role: "system", content: "You are a precise, data-driven equity analyst. Never refuse. Always return clean JSON." },
          { role: "user", content: prompt }
        ]
      })
    });

    if (!r.ok) return null;
    const d = await r.json();
    const text = d.choices?.[0]?.message?.content || '';
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch(e) {
    console.error('Grok call failed:', e);
    return null;
  }
}

async function processSector(sectorKey) {
  const today = new Date().toISOString().split('T')[0];
  const sec = await fbGet(`stock_universe/${sectorKey}`);
  if (!sec?.stocks) return { error: `${sectorKey} not in universe` };

  const pool = sec.stocks;

  // PHASE 1: Quick quotes
  const withQt = (await Promise.all(pool.map(async s => {
    const q = await quote(s.t);
    return q ? { ...s, qt: q } : null;
  }))).filter(Boolean);

  // PHASE 2: Sort by movement
  withQt.sort((a, b) => Math.abs(b.qt.pct || 0) - Math.abs(a.qt.pct || 0));

  // PHASE 3: Enrich top 8
  const top8 = withQt.slice(0, 8);
  const enriched = await Promise.all(top8.map(async s => {
    const [nw, rc] = await Promise.all([news(s.t), recs(s.t)]);
    let str = Math.min(40, Math.abs(s.qt.pct || 0) * 8);
    if (rc?.total > 0) str += (rc.buy / rc.total) * 20;
    str += Math.min(20, nw.length * 5);
    return { ...s, nw, rc, str: Math.round(str) };
  }));

  // PHASE 4: Grok analysis on top 6
  enriched.sort((a, b) => b.str - a.str);
  const picks = enriched.slice(0, 6);
  const results = {};
  let ok = 0;

  await Promise.all(picks.map(async s => {
    const ai = await grokAnalyze(s.t, sec.name, s.qt, s.nw, s.rc);
    let strength = s.str;
    if (ai) {
      const sm = { 'Strongly Bullish': 30, 'Bullish': 20, 'Neutral': 0, 'Cautious': -10, 'Bearish': -20 };
      strength += sm[ai.sentiment] || 0;
      ok++;
    }
    results[s.t] = {
      quote: s.qt,
      news: s.nw,
      recs: s.rc,
      analysis: ai,
      sector: sectorKey,
      strength,
      name: s.n,
      exchange: s.x,
      industry: s.i,
      description: ai?.description || '',
      at: new Date().toISOString()
    };
  }));

  // Save to Firebase
  await fbPatch(`daily_analysis/${today}/stocks`, results);

  const featured = Object.entries(results)
    .sort((a, b) => b[1].strength - a[1].strength)
    .slice(0, 6)
    .map(([tk, d]) => ({
      ticker: tk,
      name: d.name,
      exchange: d.exchange,
      industry: d.industry,
      strength: d.strength,
      sentiment: d.analysis?.sentiment || 'Neutral',
      direction: ['Strongly Bullish', 'Bullish'].includes(d.analysis?.sentiment) ? 'Bullish' : ['Cautious', 'Bearish'].includes(d.analysis?.sentiment) ? 'Bearish' : 'Neutral',
      pct: d.quote?.pct || 0,
      price: d.quote?.price || 0,
      description: d.description || ''
    }));

  await fbPut(`daily_analysis/${today}/rankings/${sectorKey}`, {
    featured,
    scanned: pool.length,
    analyzed: ok,
    at: new Date().toISOString()
  });

  return {
    sector: sectorKey,
    scanned: pool.length,
    analyzed: ok,
    featured: featured.map(f => f.ticker)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return cors(200, {});

  const p = event.queryStringParameters || {};

  if (!SECRET) return cors(500, { error: 'Set FIREBASE_DB_SECRET' });
  if (!GROK_KEY) return cors(500, { error: 'Set GROK_API_KEY' });

  const universe = await fbGet('stock_universe');
  if (!universe) return cors(500, { error: 'Run seed-universe first' });

  if (p.sector) return cors(200, await processSector(p.sector));

  if (p.run === 'all') {
    const results = [];
    for (const k of Object.keys(universe)) {
      try {
        results.push(await processSector(k));
      } catch (e) {
        results.push({ sector: k, error: e.message });
      }
    }
    return cors(200, { results });
  }

  return cors(200, {
    engine: 'Atlas v2 - Grok Powered',
    sectors: Object.keys(universe)
  });
};
