/// <reference types="@cloudflare/workers-types" />
import type { Env } from './env';
import { err, preflight } from './lib/http';

// Handlers (we will clean these next one by one)
import { handleAuth } from './handlers/auth';
import { handleStripeWebhook } from './handlers/stripe';
import { handleQuote, handleQuotesBatch } from './handlers/quotes';
import { handleAnalysis, handleRunAnalysis, handleTrackRecord } from './handlers/analysis';
import { handleUniverse } from './handlers/universe';
import { handlePriceStream } from './handlers/sse';
import { handleAdmin } from './handlers/admin';

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
      return err(500, 'internal error', req, env, { 
        detail: env.ENVIRONMENT === 'development' ? String(e) : undefined 
      });
    }
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const cron = event.cron || '';
    
    if (cron.startsWith('30 13')) {
      // Daily Grok-powered analysis
      console.log('🚀 Daily Grok analysis triggered');
      // ctx.waitUntil(runDailyAnalysis(env)... → we'll rebuild this clean next)
    } else if (cron.startsWith('*/1')) {
      // Price cache warm
      console.log('🔥 Price cache warm triggered');
    }
  },
};
