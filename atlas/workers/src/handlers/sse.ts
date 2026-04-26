import type { Env } from '../env';
import { corsHeaders } from '../lib/http';
import { getQuotesBatch } from '../data/quote';

// Server-Sent Events stream of price updates. Replaces the legacy 10s polling
// loop that triggered full-page re-renders on the frontend.
//
// Wire format (each event):
//   event: prices
//   data: {"ts": <ms>, "quotes": {"AAPL": {...}, ...}}
//
// Client EventSource auto-reconnects on disconnect. We push every 15s during
// market hours, every 60s otherwise. Cloudflare Workers can sustain SSE
// for up to 5 minutes per request — client reconnects transparently.

function isMarketOpen(): boolean {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  const dow = parts.weekday;
  if (dow === 'Sat' || dow === 'Sun') return false;
  const mins = Number(parts.hour) * 60 + Number(parts.minute);
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

export async function handlePriceStream(req: Request, env: Env): Promise<Response> {
  const u = new URL(req.url);
  const tickersParam = u.searchParams.get('t');
  if (!tickersParam) return new Response('t param required', { status: 400 });
  const tickers = tickersParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 60);

  const intervalMs = isMarketOpen() ? 15_000 : 60_000;
  const maxDurationMs = 4 * 60_000; // safe under Worker 5min cap
  const start = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // Initial flush so the client paints with real values immediately
      const initial = await getQuotesBatch(env, tickers);
      send('prices', { ts: Date.now(), quotes: initial });
      send('hello', { intervalMs });

      let timer: any;
      const tick = async () => {
        if (Date.now() - start > maxDurationMs) {
          send('bye', { reason: 'rotate' });
          controller.close();
          return;
        }
        try {
          const q = await getQuotesBatch(env, tickers);
          send('prices', { ts: Date.now(), quotes: q });
        } catch (e) {
          send('error', { message: (e as Error).message });
        }
        timer = setTimeout(tick, intervalMs);
      };
      timer = setTimeout(tick, intervalMs);

      const abort = () => { if (timer) clearTimeout(timer); try { controller.close(); } catch {} };
      // @ts-ignore - signal exists on Request in Workers
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
    },
  });
}
