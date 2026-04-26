/// <reference types="@cloudflare/workers-types" />
import type { Env } from './env';
import { err, preflight } from './lib/http';
import { handleAuth } from './handlers/auth';
import { handleStripeWebhook } from './handlers/stripe';
import { handleQuote, handleQuotesBatch } from './handlers/quotes';
import { handleAnalysis, handleRunAnalysis, handleTrackRecord } from './handlers/analysis';
import { handleUniverse } from './handlers/universe';
import { handlePriceStream } from './handlers/sse';
import { handleAdmin } from './handlers/admin';
import { runDailyAnalysis } from './ai/pipeline';
import { backfillReturns } from './ai/backtest';

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method === 'OPTIONS') return preflight(req, env);

    const url = new URL(req.url);
    const p = url.pathname;

    try {
      // Public endpoints
      if (p === '/api/auth')           return await handleAuth(req, env);
      if (p === '/api/stripe/webhook') return await handleStripeWebhook(req, env);
      if (p === '/api/universe')       return await handleUniverse(req, env);
      if (p === '/api/quote')          return await handleQuote(req, env);
      if (p === '/api/quotes')         return await handleQuotesBatch(req, env);
      if (p === '/api/analysis')       return await handleAnalysis(req, env);
      if (p === '/api/track-record')   return await handleTrackRecord(req, env);
      if (p === '/api/sse/prices')     return await handlePriceStream(req, env);

      // Admin / staff endpoints
      if (p === '/api/admin')          return await handleAdmin(req, env);
      if (p === '/api/analysis/run')   return await handleRunAnalysis(req, env);

      if (p === '/api/healthz') return new Response('ok', { status: 200 });

      return err(404, 'not found', req, env);
    } catch (e) {
      console.error('worker error', e);
      return err(500, 'internal error', req, env, { detail: env.ENVIRONMENT === 'development' ? String(e) : undefined });
    }
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // 09:30 ET cron triggers daily analysis; minute-by-minute crons during market
    // hours warm the price cache (idempotent, cheap).
    const cron = event.cron || '';
    if (cron.startsWith('30 13')) {
      ctx.waitUntil(runDailyAnalysis(env).then(() => backfillReturns(env)).catch(e => console.error('cron daily', e)));
    } else if (cron.startsWith('*/1')) {
      // Cache warm: refresh featured tickers
      ctx.waitUntil((async () => {
        const today = new Date().toISOString().split('T')[0];
        const r = await env.DB.prepare(`SELECT payload_json FROM rankings WHERE date = ?`).bind(today).all<{ payload_json: string }>();
        const set = new Set<string>();
        for (const row of (r.results ?? [])) {
          try { (JSON.parse(row.payload_json) as Array<{ ticker: string }>).forEach(f => set.add(f.ticker)); } catch {}
        }
        if (set.size) {
          const { getQuotesBatch } = await import('./data/quote');
          await getQuotesBatch(env, [...set]);
        }
      })().catch(() => {}));
    }
  },
};
