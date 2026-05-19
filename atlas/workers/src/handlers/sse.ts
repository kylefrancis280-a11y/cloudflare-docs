// atlas/workers/src/handlers/sse.ts
import type { Env } from '../env';
import { corsHeaders } from '../lib/http';
import { getQuotesBatch } from '../data/quote';

const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/;

/**
 * Server-Sent Events (SSE) stream for live price updates
 * Replaces old 10s polling on the frontend.
 *
 * Event format:
 * event: prices
 * data: {"ts": 1747680000000, "quotes": {"AAPL": {...}, ...}}
 */
export async function handlePriceStream(req: Request, env: Env): Promise<Response> {
  const u = new URL(req.url);
  const tickersParam = u.searchParams.get('t');

  if (!tickersParam) return err(400, 't param required (e.g. ?t=NVDA,AAPL,TSLA)', req, env);

  const tickers = tickersParam
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(s => TICKER_RE.test(s))
    .slice(0, 60);

  if (!tickers.length) return err(400, 'no valid tickers', req, env);

  const intervalMs = isMarketOpen() ? 15_000 : 60_000;   // 15s market / 60s closed
  const maxDurationMs = 4 * 60_000;                       // safe under 5min Worker limit

  const start = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // Initial snapshot so client paints immediately
      const initial = await getQuotesBatch(env, tickers);
      send('prices', { ts: Date.now(), quotes: initial });
      send('hello', { intervalMs });

      let timer: NodeJS.Timeout;

      const tick = async () => {
        if (Date.now() - start > maxDurationMs) {
          send('bye', { reason: 'stream_rotate' });
          controller.close();
          return;
        }

        try {
          const quotes = await getQuotesBatch(env, tickers);
          send('prices', { ts: Date.now(), quotes });
        } catch (e) {
          send('error', { message: (e as Error).message });
        }

        timer = setTimeout(tick, intervalMs);
      };

      timer = setTimeout(tick, intervalMs);

      // Cleanup on disconnect
      const abort = () => {
        if (timer) clearTimeout(timer);
        try { controller.close(); } catch {}
      };

      // @ts-ignore - Request.signal exists in Workers
      req.signal?.addEventListener('abort', abort);
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders(req, env),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** Market hours check (09:30–16:00 ET) */
function isMarketOpen(): boolean {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  const dow = parts.weekday;
  if (dow === 'Sat' || dow === 'Sun') return false;

  const mins = Number(parts.hour) * 60 + Number(parts.minute);
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}
