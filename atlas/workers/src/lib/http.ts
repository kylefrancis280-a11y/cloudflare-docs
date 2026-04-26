import type { Env } from '../env';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), interest-cohort=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

export function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = env.ALLOWED_ORIGINS.split(',').map(s => s.trim());
  const ok = allowed.includes(origin) || env.ENVIRONMENT === 'development';
  return {
    'Access-Control-Allow-Origin': ok ? origin : allowed[0] ?? '',
    'Vary': 'Origin',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}

export function json<T>(data: T, init: ResponseInit = {}, req?: Request, env?: Env): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  if (req && env) for (const [k, v] of Object.entries(corsHeaders(req, env))) headers.set(k, v);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function err(status: number, message: string, req?: Request, env?: Env, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, { status }, req, env);
}

export function preflight(req: Request, env: Env): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req, env) });
}

// Strict HTML escape — applied to anything that flows from an external API
// (news headlines, AI summaries, ticker/company names) before it's rendered.
export function escapeHtml(input: unknown): string {
  if (input == null) return '';
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Drop any field that isn't safe to expose to the browser.
export function sanitizeNewsItem(n: { headline?: unknown; source?: unknown; url?: unknown; ts?: unknown; sentiment?: unknown }) {
  const url = String(n.url ?? '').trim();
  const safeUrl = /^https?:\/\//i.test(url) ? url : '';
  return {
    headline: escapeHtml(n.headline).slice(0, 300),
    source: escapeHtml(n.source).slice(0, 60),
    url: safeUrl,
    ts: Number(n.ts) || 0,
    sentiment: (['positive', 'negative', 'neutral'].includes(String(n.sentiment)) ? String(n.sentiment) : 'neutral') as 'positive' | 'negative' | 'neutral',
  };
}

// Constant-time string compare used for token + signature verification.
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export function bytesToBase64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.byteLength; i++) bin += String.fromCharCode(arr[i]!);
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return bytesToHex(hash);
}

export function clientIp(req: Request): string {
  return (
    req.headers.get('CF-Connecting-IP') ||
    req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

export function clientUA(req: Request): string {
  return (req.headers.get('User-Agent') || '').slice(0, 200);
}

export function todayET(): string {
  // ET (America/New_York) calendar date, formatted YYYY-MM-DD.
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(now);
}
