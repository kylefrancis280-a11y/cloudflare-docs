/// <reference types="@cloudflare/workers-types" />
import type { Env } from './env';
import { err, preflight } from './lib/http';

// All handlers are now Grok-powered
import { handleAuth } from './handlers/auth';
import { handleStripeWebhook } from './handlers/stripe';
import { handleQuote, handleQuotesBatch } from './handlers/quotes';
import { handleAnalysis, handleRunAnalysis, handleTrackRecord } from './handlers/analysis';
import { handleUniverse } from './handlers/universe';
import { handlePriceStream } from './handlers/sse';
import { handleAdmin } from './handlers/admin';

// Import the clean Grok-powered daily pipeline
import { runDailyAnalysis } from './ai/pipeline';

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method === 'OPTIONS') return preflight(req, env);

    const url = new URL(req.url);
    const p = url.pathname;

    try {
      // ── Public endpoints ─────────────────────────────────────
      if (p === '/api/auth')           return await handleAuth(req, env);
      if (p === '/api/stripe/webhook') return await handleStripeWebhook(req, env);
      if (p === '/api/universe')       return await handleUniverse(req, env);
      if (p === '/api/quote')          return await handleQuote(req, env);
      if (p === '/api/quotes')         return await handleQuotesBatch(req, env);
      if (p === '/api/analysis')       return await handleAnalysis(req, env);
      if (p === '/api/track-record')   return await handleTrackRecord(req, env);
      if (p === '/api/sse/prices')     return await handlePriceStream(req, env);

      // ── Admin / Staff endpoints ───────────────────────────────
      if (p === '/api/admin')          return await handleAdmin(req, env);
      if (p === '/api/analysis/run')   return await handleRunAnalysis(req, env);

      if (p === '/api/healthz') return new Response('ok', { status: 200 });

      return err(404, 'not found', req, env);
    } catch (e) {
      console.error('worker error', e);
      return err(500, 'internal error', req, env, {
        detail: env.ENVIRONMENT === 'development' ? String(e) : undefined
      });
    }
  },

  /**
   * Scheduled tasks (cron)
   * - Daily Grok-powered analysis at 13:30 UTC (8:30 AM EST)
   * - Price cache warming every minute during market hours
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const cron = event.cron || '';

    if (cron.startsWith('30 13')) {
      // Daily full Grok analysis run
      console.log('🚀 [SCHEDULED] Starting daily Grok-powered analysis...');
      ctx.waitUntil(
        runDailyAnalysis(env)
          .then(() => console.log('✅ Daily analysis completed'))
          .catch(e => console.error('❌ Daily analysis failed', e))
      );
    } 
    else if (cron.startsWith('*/1')) {
      // Price cache warm (runs every minute during market hours)
      console.log('🔥 [SCHEDULED] Warming price cache...');
      // This is handled automatically inside getQuotesBatch / getQuote
    }
  },
};
