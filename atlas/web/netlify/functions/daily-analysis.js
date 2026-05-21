const https = require('https');

const POLYGON_KEY = process.env.POLYGON_API_KEY;
const GROK_KEY = process.env.GROK_API_KEY;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_DB_SECRET = process.env.FIREBASE_DB_SECRET;

const SECTORS = {
  technology: ['NVDA','MSFT','GOOGL','META','AAPL','AMD','PLTR','CRM','SNOW','NET','DDOG','MDB','CRWD','ZS','PANW','SMCI','AVGO','QCOM','INTC','TSM'],
  mining: ['ABX','FCX','NEM','AEM','WPM','GOLD','KGC','AG','HL','CDE','PAAS','MAG','EXK','FSM','SILV','SSRM','BTG','NGD','IAG','OR'],
  biotech: ['MRNA','BNTX','REGN','VRTX','BIIB','GILD','AMGN','ILMN','SGEN','ALNY','BMRN','RARE','FOLD','ACAD','SAGE','ARWR','BEAM','EDIT','NTLA','CRSP'],
  defense: ['LMT','RTX','NOC','GD','BA','L3H','HII','TDG','HEICO','AXON','KTOS','RCAT','JOBY','ACHR','LILM','PLTR','BWXT','DRS','CACI','SAIC'],
  energy: ['XOM','CVX','COP','EOG','PXD','DVN','MPC','VLO','PSX','SLB','HAL','BKR','OXY','FANG','APA','MRO','HES','CTRA','SM','MTDR'],
  financials: ['JPM','BAC','GS','MS','WFC','C','BLK','SCHW','AXP','V','MA','PYPL','SQ','COIN','HOOD','SOFI','NU','AFRM','UPST','LC'],
  cannabis: ['TLRY','CGC','ACB','CRON','OGI','SNDL','APHA','HEXO','VFF','GTBIF','CURLF','TCNNF','MMNFF','CCHWF','AYRWF','FLGC','IIPR','HYFM','GRWG','KERN']
};

function httpsGet(hostname, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = { hostname, path, method: 'GET', headers };
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); } });
    });
    req.on('error', reject);
    req.end();
  });
}

function httpsPost(hostname, path, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const options = {
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers }
    };
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function getQuote(ticker) {
  try {
    const res = await httpsGet('api.polygon.io', `/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${POLYGON_KEY}`);
    if (res.body.results && res.body.results[0]) {
      const r = res.body.results[0];
      return { ticker, open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v, vwap: r.vw };
    }
  } catch {}
  return { ticker, close: 0, volume: 0 };
}

async function getNews(ticker) {
  try {
    const res = await httpsGet('api.polygon.io', `/v2/reference/news?ticker=${ticker}&limit=3&apiKey=${POLYGON_KEY}`);
    return (res.body.results || []).map(n => ({ title: n.title, url: n.article_url, published: n.published_utc }));
  } catch { return []; }
}

async function grokAnalyze(ticker, quote, news) {
  if (!GROK_KEY) return { score: 75, thesis: 'AI analysis unavailable', sentiment: 'neutral', target: quote.close * 1.1 };
  try {
    const newsText = news.map(n => n.title).join('; ');
    const prompt = `Analyze ${ticker} stock. Price: $${quote.close?.toFixed(2)}, Volume: ${quote.volume?.toLocaleString()}, Recent news: ${newsText || 'none'}. 
    Respond with JSON only: {"score": 0-100, "thesis": "2 sentence bull thesis", "sentiment": "bullish|neutral|bearish", "target": price_number, "risks": "main risk in 1 sentence", "catalysts": "main catalyst in 1 sentence"}`;
    
    const res = await httpsPost('api.x.ai', '/v1/chat/completions', {
      model: 'grok-3',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 300
    }, { Authorization: `Bearer ${GROK_KEY}` });
    
    const content = res.body.choices?.[0]?.message?.content || '{}';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch {}
  return { score: 70, thesis: 'Analysis pending', sentiment: 'neutral', target: quote.close * 1.1, risks: 'Market volatility', catalysts: 'Earnings growth' };
}

function calcAtlasScore(quote, grokScore) {
  let score = grokScore || 70;
  if (quote.close > quote.open) score += 5;
  if (quote.volume > 1000000) score += 3;
  const range = quote.high - quote.low;
  if (range > 0 && (quote.close - quote.low) / range > 0.6) score += 4;
  return Math.min(100, Math.max(0, Math.round(score)));
}

async function saveToFirebase(data) {
  if (!FIREBASE_PROJECT_ID || !FIREBASE_DB_SECRET) return;
  try {
    const date = new Date().toISOString().split('T')[0];
    const body = JSON.stringify(data);
    const bodyBuf = Buffer.from(body);
    await new Promise((resolve, reject) => {
      const options = {
        hostname: `${FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`,
        path: `/analysis/${date}.json?auth=${FIREBASE_DB_SECRET}`,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Content-Length': bodyBuf.length }
      };
      const req = https.request(options, res => { res.on('data', () => {}); res.on('end', resolve); });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  } catch {}
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const params = event.queryStringParameters || {};
    const sector = params.sector || 'technology';
    const tickers = SECTORS[sector] || SECTORS.technology;
    const limit = Math.min(parseInt(params.limit || '10'), 20);
    const selectedTickers = tickers.slice(0, limit);

    const results = [];
    for (const ticker of selectedTickers) {
      const [quote, news] = await Promise.all([getQuote(ticker), getNews(ticker)]);
      const grok = await grokAnalyze(ticker, quote, news);
      const atlasScore = calcAtlasScore(quote, grok.score);
      results.push({
        ticker,
        price: quote.close,
        change: quote.close && quote.open ? ((quote.close - quote.open) / quote.open * 100).toFixed(2) : '0.00',
        volume: quote.volume,
        atlasScore,
        sentiment: grok.sentiment || 'neutral',
        thesis: grok.thesis || '',
        target: grok.target || quote.close * 1.1,
        risks: grok.risks || '',
        catalysts: grok.catalysts || '',
        news: news.slice(0, 3)
      });
    }

    results.sort((a, b) => b.atlasScore - a.atlasScore);
    const output = { sector, date: new Date().toISOString(), picks: results };
    await saveToFirebase({ [sector]: output });

    return { statusCode: 200, headers, body: JSON.stringify(output) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
