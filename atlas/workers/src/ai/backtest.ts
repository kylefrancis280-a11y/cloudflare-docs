import type { Env } from '../env';
import { getQuote } from '../data/quote';
import { todayET } from '../lib/http';

// Backtest: each evening, score yesterday's calls against today's actual return.
// Records 1d return, then later we re-record 5d / 30d. Surfaces hit rate
// per sentiment band so users can see "Bullish calls are right 62% of the time"
// instead of marketing copy.

export async function backfillReturns(env: Env, lookbackDays = 30): Promise<{ updated: number }> {
  const today = todayET();
  const cutoff = new Date(Date.now() - lookbackDays * 86_400_000).toISOString().split('T')[0];

  const rows = await env.DB.prepare(
    `SELECT a.date, a.ticker, a.strength, a.sentiment
     FROM analysis a
     LEFT JOIN backtest_returns b ON b.date = a.date AND b.ticker = a.ticker
     WHERE a.date >= ? AND a.date < ? AND b.ret_1d IS NULL
     ORDER BY a.date DESC LIMIT 500`,
  ).bind(cutoff, today).all<{ date: string; ticker: string }>();

  let updated = 0;
  for (const r of (rows.results ?? [])) {
    const q = await getQuote(env, r.ticker);
    if (!q) continue;
    // Crude 1d return: today's price vs analysis-day's prev close (best we can do without storing snapshots).
    // For accuracy, the daily run should snapshot the open price into source_data; we read from there in upgrades.
    await env.DB.prepare(
      `INSERT INTO backtest_returns (date, ticker, ret_1d) VALUES (?, ?, ?)
       ON CONFLICT(date, ticker) DO UPDATE SET ret_1d=excluded.ret_1d, computed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    ).bind(r.date, r.ticker, q.pct).run();
    updated++;
  }
  return { updated };
}

export async function trackRecord(env: Env, days = 30): Promise<{ sentiment: string; n: number; hitRate: number; avgRet: number }[]> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().split('T')[0];
  const rows = await env.DB.prepare(
    `SELECT a.sentiment, COUNT(*) AS n,
            AVG(CASE WHEN
                (a.sentiment IN ('Strongly Bullish','Bullish') AND b.ret_1d > 0)
             OR (a.sentiment IN ('Cautious','Bearish') AND b.ret_1d < 0)
             OR (a.sentiment = 'Neutral' AND ABS(b.ret_1d) < 1)
              THEN 1.0 ELSE 0.0 END) AS hit_rate,
            AVG(b.ret_1d) AS avg_ret
     FROM analysis a JOIN backtest_returns b ON b.date = a.date AND b.ticker = a.ticker
     WHERE a.date >= ? AND b.ret_1d IS NOT NULL
     GROUP BY a.sentiment`,
  ).bind(cutoff).all<{ sentiment: string; n: number; hit_rate: number; avg_ret: number }>();

  return (rows.results ?? []).map(r => ({
    sentiment: r.sentiment, n: r.n, hitRate: +(r.hit_rate * 100).toFixed(1), avgRet: +(r.avg_ret).toFixed(2),
  }));
}
