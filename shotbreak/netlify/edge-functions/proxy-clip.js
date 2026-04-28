// SHOTBREAK — WaveSpeed clip proxy (Edge Function)
// Streams CDN videos to the browser — no 6MB cap, no base64 overhead.
// Handles large clips (100MB+) by piping the upstream body directly.
// Uses Web Crypto to verify Firebase ID tokens without the Admin SDK.

const CORS = {
  'Access-Control-Allow-Origin': 'https://shotbreak.io',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ── Firebase public-key cache ────────────────────────────────────────────────
let _keyCache = null;
let _keyCacheExpiry = 0;

async function getPublicKeys() {
  if (_keyCache && Date.now() < _keyCacheExpiry) return _keyCache;
  const r = await fetch(
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
  );
  const { keys } = await r.json();
  const cc = r.headers.get('cache-control') || '';
  const maxAge = parseInt(cc.match(/max-age=(\d+)/)?.[1] || '3600', 10);
  const map = {};
  for (const k of keys) {
    map[k.kid] = await crypto.subtle.importKey(
      'jwk', k,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['verify']
    );
  }
  _keyCache = map;
  _keyCacheExpiry = Date.now() + maxAge * 1000;
  return map;
}

function b64url(s) {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - padded.length % 4) % 4;
  return atob(padded + '='.repeat(pad));
}

async function verifyFirebaseJwt(token, projectId) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed JWT');
  let header, payload;
  try {
    header  = JSON.parse(b64url(parts[0]));
    payload = JSON.parse(b64url(parts[1]));
  } catch { throw new Error('decode error'); }

  const now = Math.floor(Date.now() / 1000);
  if ((payload.exp || 0) < now) throw new Error('token expired');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('wrong issuer');
  if (payload.aud !== projectId) throw new Error('wrong audience');
  if (!payload.sub) throw new Error('missing sub');

  const keys = await getPublicKeys();
  const key = keys[header.kid];
  if (!key) throw new Error('unknown signing key');

  const sigBytes = Uint8Array.from(b64url(parts[2]), c => c.charCodeAt(0));
  const ok = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    key,
    sigBytes,
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!ok) throw new Error('invalid signature');
  return payload;
}

// ── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'POST required' });

  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return json(401, { error: 'Login required' });

  const projectId = Netlify.env.get('FIREBASE_PROJECT_ID') || 'shotbreak-9f342';
  try {
    await verifyFirebaseJwt(token, projectId);
  } catch {
    return json(401, { error: 'Login required' });
  }

  let body;
  try { body = await req.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { url } = body;
  if (!url || typeof url !== 'string') return json(400, { error: 'url required' });

  // Only proxy WaveSpeed CDN — prevents SSRF to arbitrary hosts
  const allowed = /^https:\/\/([a-z0-9][a-z0-9-]*\.)*wavespeed\.ai\//i;
  if (!allowed.test(url)) return json(403, { error: 'URL not from an allowed domain' });

  let upstream;
  try { upstream = await fetch(url); }
  catch (e) { return json(502, { error: 'Proxy fetch failed: ' + e.message }); }
  if (!upstream.ok) return json(502, { error: 'CDN fetch failed: HTTP ' + upstream.status });

  const ct = upstream.headers.get('content-type') || 'video/mp4';
  const cl = upstream.headers.get('content-length');
  const headers = { ...CORS, 'Content-Type': ct, 'Cache-Control': 'public, max-age=3600' };
  if (cl) headers['Content-Length'] = cl;

  // Pipe body directly — streaming, no buffering, no size limit
  return new Response(upstream.body, { status: 200, headers });
}

export const config = { path: '/proxy-clip' };
