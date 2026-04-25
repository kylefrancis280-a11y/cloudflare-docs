import type { Env, AnalystRecs, AnalysisResult, NewsItem, Quote, Sentiment } from '../env';
import { callClaude, extractJson } from './claude';
import { getQuotesBatch, getQuote } from '../data/quote';
import { getNews, getRecs } from '../data/news';
import { getMacro, getRecentFilings, type MacroSnapshot } from '../data/macro';
import { sha256Hex, todayET } from '../lib/http';

// ── System prompt: cached so we only pay full input cost once per cache window.
const SYSTEM_FRAMEWORK = `You are a senior equity research analyst at Atlas Analysis. You write concise, data-driven research notes for a paying audience that already understands markets.

Your discipline:
- ALWAYS reference the supplied numbers (price, % change, day range, prev close, recommendations, news, macro context) explicitly. Do not editorialize.
- When data is missing or stale, say so and lower confidence; do not invent numbers.
- Prefer specific factors ("trading 4.1% above 50-day", "5 of 7 covering analysts upgraded last 30 days", "10y-2y spread is -0.3 indicating inversion") over generic adjectives.
- Bulls and bears must be distinct, falsifiable, dated when relevant. No platitudes.
- Sentiment must be one of: "Strongly Bullish" | "Bullish" | "Neutral" | "Cautious" | "Bearish".
- Strength is implied by sentiment + factor count; the JSON sentiment + your factor lists drive the Atlas Score.
- If price is delayed (source: "finnhub"), state it.
- Output STRICT JSON in the schema requested. No prose outside JSON. No markdown. No code fences.

Schema:
{
  "summary": "2-3 sentences referencing the supplied data",
  "sentiment": "<one of the five labels>",
  "bulls": ["3 specific bullish factors with numbers when possible"],
  "bears": ["2 specific risk factors with numbers when possible"],
  "insight": "single-sentence key takeaway, actionable",
  "description": "single-sentence company description"
}`;

const ATLAS_SCORE_BOUNDS = { min: 22, max: 97 };

// ── Stage 1: NUMBERS (server-side, deterministic; no LLM) ───────────────
//
// Computes the structural score components: momentum, valuation, breadth,
// macro alignment. These are real, derived from quotes + recs + macro.
// LLM never sees the raw weights — only the final factor breakdown.
interface Factors {
  momentum: number;       // 0–100, based on % move + range position
  recommendation: number; // 0–100, analyst breadth
  newsMomentum: number;   // 0–100, recency + sentiment
  macroAlignment: number; // 0–100, sector vs macro regime
  valuation: number;      // 0–100, derived from P/E percentile (placeholder)
}

function computeFactors(opts: {
  quote: Quote;
  recs: AnalystRecs | null;
  news: NewsItem[];
  macro: MacroSnapshot | null;
  sector: string;
  pe: number | null | undefined;
}): Factors {
  const { quote, recs, news, macro, sector, pe } = opts;

  // 1. Momentum: scaled |% change| + position within day range
  const range = quote.hi - quote.lo;
  const posInRange = range > 0 ? (quote.price - quote.lo) / range : 0.5;
  const momentum = clamp(50 + (quote.pct ?? 0) * 4 + (posInRange - 0.5) * 30);

  // 2. Recommendation breadth
  let recommendation = 50;
  if (recs && recs.total > 0) {
    const buyShare = recs.buy / recs.total;
    const sellShare = recs.sell / recs.total;
    recommendation = clamp(50 + (buyShare - sellShare) * 60);
  }

  // 3. News momentum: count + sentiment + recency
  const now = Date.now();
  const recentNews = news.filter(n => now - n.ts < 7 * 86_400_000);
  const sentimentSum = recentNews.reduce((a, n) => a + (n.sentiment === 'positive' ? 1 : n.sentiment === 'negative' ? -1 : 0), 0);
  const newsMomentum = clamp(50 + sentimentSum * 6 + Math.min(20, recentNews.length * 2));

  // 4. Macro alignment by sector vs current macro regime (heuristic; scored 30–80)
  const macroAlignment = macroSectorScore(sector, macro);

  // 5. Valuation
  const valuation = peScore(pe);

  return { momentum, recommendation, newsMomentum, macroAlignment, valuation };
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function peScore(pe: number | null | undefined): number {
  if (!pe || pe <= 0) return 50;
  if (pe < 12) return 78;
  if (pe < 18) return 70;
  if (pe < 25) return 60;
  if (pe < 35) return 50;
  if (pe < 50) return 38;
  return 28;
}

function macroSectorScore(sector: string, macro: MacroSnapshot | null): number {
  if (!macro) return 50;
  const inverted = (macro.yieldCurveSpread ?? 0) < 0;
  const highRates = (macro.fedFundsTarget ?? 0) > 4.0;
  const highVix = (macro.vix ?? 15) > 22;
  const map: Record<string, number> = {
    mining:  inverted ? 60 : 50,
    ai:      highVix ? 45 : 65,
    tech:    highRates ? 40 : 65,
    biotech: highVix ? 50 : 55,
    energy:  highRates ? 60 : 55,
    defense: highVix || inverted ? 65 : 55,
    media:   highRates ? 38 : 55,
    other:   50,
  };
  return map[sector] ?? 50;
}

function combineFactorsToStrength(f: Factors, sentimentBoost: number): number {
  const weights = { momentum: 0.30, recommendation: 0.20, newsMomentum: 0.15, macroAlignment: 0.20, valuation: 0.15 };
  let s = f.momentum * weights.momentum
        + f.recommendation * weights.recommendation
        + f.newsMomentum * weights.newsMomentum
        + f.macroAlignment * weights.macroAlignment
        + f.valuation * weights.valuation;
  s += sentimentBoost;
  return Math.round(clamp(s, ATLAS_SCORE_BOUNDS.min, ATLAS_SCORE_BOUNDS.max));
}

const SENTIMENT_BOOST: Record<Sentiment, number> = {
  'Strongly Bullish': +12,
  'Bullish':          +6,
  'Neutral':          0,
  'Cautious':         -6,
  'Bearish':          -12,
};

// ── Stage 2: NARRATIVE (Claude) ────────────────────────────────────────
async function narrate(env: Env, args: {
  ticker: string;
  name: string;
  sector: string;
  industry: string | null;
  quote: Quote;
  news: NewsItem[];
  recs: AnalystRecs | null;
  macro: MacroSnapshot | null;
  filings: { form: string; filingDate: string }[];
  factors: Factors;
}): Promise<{ data: any; inputHash: string; model: string } | null> {
  const inputBlob = JSON.stringify(args);
  const inputHash = await sha256Hex(inputBlob);

  // Cache hit?
  const cached = await env.DB.prepare(
    `SELECT sentiment, summary, bulls_json, bears_json, insight, description, model FROM analysis WHERE input_hash = ? LIMIT 1`,
  ).bind(inputHash).first<any>();
  if (cached) {
    return {
      inputHash,
      model: cached.model,
      data: {
        sentiment: cached.sentiment,
        summary: cached.summary,
        bulls: JSON.parse(cached.bulls_json || '[]'),
        bears: JSON.parse(cached.bears_json || '[]'),
        insight: cached.insight,
        description: cached.description,
      },
    };
  }

  const userText = renderUserPrompt(args);
  let res;
  try {
    res = await callClaude(env, {
      system: [
        { type: 'text', text: SYSTEM_FRAMEWORK, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: userText }],
      maxTokens: 700,
    });
  } catch (e) {
    console.error('claude failure', e);
    return null;
  }

  const parsed = extractJson<{
    summary: string; sentiment: Sentiment;
    bulls: string[]; bears: string[];
    insight: string; description: string;
  }>(res.text);
  if (!parsed.ok) return null;

  return { data: parsed.data, inputHash, model: 'claude-sonnet-4-6' };
}

function renderUserPrompt(args: Parameters<typeof narrate>[1]): string {
  const { ticker, name, sector, industry, quote, news, recs, macro, filings, factors } = args;
  const recsLine = recs && recs.total > 0
    ? `Analyst breadth: ${recs.buy} Buy / ${recs.hold} Hold / ${recs.sell} Sell (${recs.total} total).`
    : `No covering analyst data.`;
  const newsBlock = news.length
    ? news.slice(0, 6).map(n => `- ${n.headline} (${n.source}, ${n.sentiment})`).join('\n')
    : 'No major headlines in the last week.';
  const macroBlock = macro
    ? `CPI YoY ${fmt(macro.cpiYoY)}%, Unemployment ${fmt(macro.unemploymentRate)}%, Fed funds ${fmt(macro.fedFundsTarget)}%, 10y ${fmt(macro.treasury10y)}%, 2y ${fmt(macro.treasury2y)}%, 10y-2y ${fmt(macro.yieldCurveSpread)}, VIX ${fmt(macro.vix)}.`
    : `Macro snapshot unavailable.`;
  const filingBlock = filings.length
    ? `Recent SEC filings: ${filings.map(f => `${f.form} ${f.filingDate}`).join(', ')}.`
    : `No recent SEC filings observed.`;

  return [
    `${ticker} — ${name} (${sector}${industry ? ' · ' + industry : ''})`,
    `Price $${quote.price.toFixed(2)} (${quote.pct >= 0 ? '+' : ''}${quote.pct.toFixed(2)}%) Range $${quote.lo.toFixed(2)}–$${quote.hi.toFixed(2)} Prev $${quote.prev.toFixed(2)}; data source: ${quote.source}${quote.delayed ? ' (delayed 15m)' : ''}.`,
    recsLine,
    `News (last 7d):\n${newsBlock}`,
    `Macro: ${macroBlock}`,
    filingBlock,
    `Computed factor scores (0–100): momentum ${factors.momentum.toFixed(0)}, recBreadth ${factors.recommendation.toFixed(0)}, newsMomentum ${factors.newsMomentum.toFixed(0)}, macroAlign ${factors.macroAlignment.toFixed(0)}, valuation ${factors.valuation.toFixed(0)}.`,
    ``,
    `Return STRICT JSON only.`,
  ].join('\n');
}

function fmt(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? 'n/a' : n.toFixed(2);
}

// ── Public: analyse a single ticker ────────────────────────────────────
export async function analyseTicker(env: Env, ticker: string): Promise<AnalysisResult | null> {
  const tk = ticker.toUpperCase();
  const meta = await env.DB.prepare(`SELECT * FROM universe WHERE ticker = ? LIMIT 1`).bind(tk).first<any>();
  if (!meta) return null;

  const [quote, news, recs, macro, filings] = await Promise.all([
    getQuote(env, tk),
    getNews(env, tk),
    getRecs(env, tk),
    getMacro(env),
    getRecentFilings(tk),
  ]);
  if (!quote) return null;

  const factors = computeFactors({ quote, recs, news, macro, sector: meta.sector, pe: meta.pe });
  const narrated = await narrate(env, {
    ticker: tk, name: meta.name, sector: meta.sector, industry: meta.industry,
    quote, news, recs, macro, filings, factors,
  });
  if (!narrated) return null;

  const sentiment = (narrated.data.sentiment ?? 'Neutral') as Sentiment;
  const strength = combineFactorsToStrength(factors, SENTIMENT_BOOST[sentiment] ?? 0);

  const today = todayET();
  await env.DB.prepare(
    `INSERT INTO analysis (date, ticker, sector, strength, sentiment, summary, bulls_json, bears_json, insight, description, model, input_hash, source_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date, ticker) DO UPDATE SET
       strength=excluded.strength, sentiment=excluded.sentiment, summary=excluded.summary,
       bulls_json=excluded.bulls_json, bears_json=excluded.bears_json,
       insight=excluded.insight, description=excluded.description,
       model=excluded.model, input_hash=excluded.input_hash, source_data=excluded.source_data`,
  ).bind(
    today, tk, meta.sector, strength, sentiment,
    String(narrated.data.summary ?? ''),
    JSON.stringify(narrated.data.bulls ?? []),
    JSON.stringify(narrated.data.bears ?? []),
    String(narrated.data.insight ?? ''),
    String(narrated.data.description ?? ''),
    narrated.model, narrated.inputHash,
    JSON.stringify({ quote, recs, news, macro: macro?.asOf, filings: filings.map(f => f.form + ':' + f.filingDate) }),
  ).run();

  return {
    ticker: tk, sector: meta.sector,
    strength, sentiment,
    summary: String(narrated.data.summary ?? ''),
    bulls: narrated.data.bulls ?? [],
    bears: narrated.data.bears ?? [],
    insight: String(narrated.data.insight ?? ''),
    description: String(narrated.data.description ?? ''),
    model: narrated.model,
    inputHash: narrated.inputHash,
    createdAt: new Date().toISOString(),
  };
}

// ── Public: full daily run across the universe ─────────────────────────
export async function runDailyAnalysis(env: Env): Promise<{ analysed: number; ranked: number; skipped: number }> {
  const universe = await env.DB.prepare(
    `SELECT ticker, name, sector, industry, pe FROM universe WHERE active = 1`,
  ).all<{ ticker: string; name: string; sector: string; industry: string | null; pe: number | null }>();
  const rows = universe.results ?? [];
  if (!rows.length) return { analysed: 0, ranked: 0, skipped: 0 };

  // Phase 1: batch quote everything
  const quotes = await getQuotesBatch(env, rows.map(r => r.ticker));

  // Phase 2: rank by abs % move, take top 6 per sector for narrative pass
  const bySector: Record<string, Array<{ row: typeof rows[number]; quote: Quote }>> = {};
  for (const row of rows) {
    const q = quotes[row.ticker];
    if (!q) continue;
    (bySector[row.sector] ??= []).push({ row, quote: q });
  }
  for (const k of Object.keys(bySector)) {
    bySector[k]!.sort((a, b) => Math.abs(b.quote.pct) - Math.abs(a.quote.pct));
    bySector[k] = bySector[k]!.slice(0, 6);
  }

  let analysed = 0, skipped = 0;
  const today = todayET();
  const sectorRankings: Record<string, Array<{ ticker: string; name: string; sentiment: Sentiment; strength: number; pct: number; price: number; description: string }>> = {};

  for (const [sector, arr] of Object.entries(bySector)) {
    const featured: typeof sectorRankings[string] = [];
    for (const { row } of arr) {
      try {
        const r = await analyseTicker(env, row.ticker);
        if (!r) { skipped++; continue; }
        analysed++;
        const q = quotes[row.ticker]!;
        featured.push({
          ticker: row.ticker, name: row.name, sentiment: r.sentiment,
          strength: r.strength, pct: q.pct, price: q.price, description: r.description,
        });
      } catch (e) { skipped++; console.error('analyseTicker', row.ticker, e); }
    }
    featured.sort((a, b) => b.strength - a.strength);
    sectorRankings[sector] = featured;
    await env.DB.prepare(
      `INSERT INTO rankings (date, sector, payload_json, scanned, analyzed) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(date, sector) DO UPDATE SET
         payload_json=excluded.payload_json, scanned=excluded.scanned, analyzed=excluded.analyzed`,
    ).bind(today, sector, JSON.stringify(featured), arr.length, featured.length).run();
  }

  return { analysed, ranked: Object.keys(sectorRankings).length, skipped };
}
