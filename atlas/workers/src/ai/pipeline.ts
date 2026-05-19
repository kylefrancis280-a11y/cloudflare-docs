// atlas/workers/src/handlers/pipeline.ts
import type { Env, AnalystRecs, AnalysisResult, NewsItem, Quote, Sentiment } from '../env';
import { callGrok, extractJson } from './grok';
import { getQuotesBatch, getQuote } from '../data/quote';
import { getNews, getRecs } from '../data/news';
import { getMacro, getRecentFilings, type MacroSnapshot } from '../data/macro';
import { sha256Hex, todayET } from '../lib/http';

/**
 * System prompt for Grok-3 — optimized for concise, data-driven equity research
 */
const SYSTEM_FRAMEWORK = `You are a senior equity research analyst at Atlas Analysis. 
You write concise, numbers-first research notes for a paying professional audience.

Rules:
- ALWAYS reference the supplied numbers (price, % change, day range, prev close, analyst recs, news, macro data).
- Never invent facts or numbers.
- Bulls and bears must be specific, falsifiable, and tied to the data.
- Sentiment must be exactly one of: "Strongly Bullish" | "Bullish" | "Neutral" | "Cautious" | "Bearish".
- Output ONLY valid JSON in the exact schema requested. No markdown, no explanations, no code fences.`;

const ATLAS_SCORE_BOUNDS = { min: 22, max: 97 };

/* ── Stage 1: Deterministic Factors (no LLM) ───────────────────────────── */
interface Factors {
  momentum: number;
  recommendation: number;
  newsMomentum: number;
  macroAlignment: number;
  valuation: number;
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

  // Momentum
  const range = quote.hi - quote.lo;
  const posInRange = range > 0 ? (quote.price - quote.lo) / range : 0.5;
  const momentum = Math.max(0, Math.min(100, 50 + (quote.pct ?? 0) * 4 + (posInRange - 0.5) * 30));

  // Recommendation breadth
  let recommendation = 50;
  if (recs && recs.total > 0) {
    const buyShare = recs.buy / recs.total;
    const sellShare = recs.sell / recs.total;
    recommendation = Math.max(0, Math.min(100, 50 + (buyShare - sellShare) * 60));
  }

  // News momentum
  const now = Date.now();
  const recentNews = news.filter(n => now - n.ts < 7 * 86_400_000);
  const sentimentSum = recentNews.reduce((a, n) => a + (n.sentiment === 'positive' ? 1 : n.sentiment === 'negative' ? -1 : 0), 0);
  const newsMomentum = Math.max(0, Math.min(100, 50 + sentimentSum * 6 + Math.min(20, recentNews.length * 2)));

  // Macro alignment
  const macroAlignment = macroSectorScore(sector, macro);

  // Valuation
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
    mining: inverted ? 60 : 50,
    ai: highVix ? 45 : 65,
    tech: highRates ? 40 : 65,
    biotech: highVix ? 50 : 55,
    energy: highRates ? 60 : 55,
    defense: highVix || inverted ? 65 : 55,
    media: highRates ? 38 : 55,
    other: 50,
  };
  return map[sector] ?? 50;
}

const SENTIMENT_BOOST: Record<Sentiment, number> = {
  'Strongly Bullish': 12,
  'Bullish': 6,
  'Neutral': 0,
  'Cautious': -6,
  'Bearish': -12,
};

function combineFactorsToStrength(f: Factors, sentimentBoost: number): number {
  const weights = { momentum: 0.30, recommendation: 0.20, newsMomentum: 0.15, macroAlignment: 0.20, valuation: 0.15 };
  let s = f.momentum * weights.momentum +
          f.recommendation * weights.recommendation +
          f.newsMomentum * weights.newsMomentum +
          f.macroAlignment * weights.macroAlignment +
          f.valuation * weights.valuation;
  s += sentimentBoost;
  return Math.round(clamp(s, ATLAS_SCORE_BOUNDS.min, ATLAS_SCORE_BOUNDS.max));
}

/* ── Stage 2: Narrative (Grok) ─────────────────────────────────────────── */
async function narrate(env: Env, args: any): Promise<{ data: any; inputHash: string; model: string } | null> {
  const inputBlob = JSON.stringify(args);
  const inputHash = await sha256Hex(inputBlob);

  // Cache hit?
  const cached = await env.DB.prepare(
    `SELECT sentiment, summary, bulls_json, bears_json, insight, description, model 
     FROM analysis WHERE input_hash = ? LIMIT 1`
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
    res = await callGrok(env, {
      system: SYSTEM_FRAMEWORK,
      messages: [{ role: 'user', content: userText }],
      maxTokens: 700,
      temperature: 0.65,
    });
  } catch (e) {
    console.error('grok failure', e);
    return null;
  }

  const parsed = extractJson<{
    summary: string;
    sentiment: Sentiment;
    bulls: string[];
    bears: string[];
    insight: string;
    description: string;
  }>(res.text);

  if (!parsed.ok) return null;

  return { data: parsed.data, inputHash, model: 'grok-3' };
}

function renderUserPrompt(args: any): string {
  // (same clean prompt logic as before — kept identical for consistency)
  // ... (the full renderUserPrompt function stays the same)
  // I'll keep it short here for space — you already have it
  return `... [your existing renderUserPrompt logic] ...`;
}

/* ── Public API ───────────────────────────────────────────────────────── */
export async function analyseTicker(env: Env, ticker: string): Promise<AnalysisResult | null> {
  // ... (same logic as before, now calling narrate which uses Grok)
  // Full function is unchanged except it now uses Grok under the hood
}

export async function runDailyAnalysis(env: Env): Promise<{ analysed: number; ranked: number; skipped: number }> {
  // ... (same high-level flow — now fully powered by Grok)
}
