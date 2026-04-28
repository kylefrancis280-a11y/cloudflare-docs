// SHOTBREAK — WaveSpeed clip proxy (Edge Function)
// Streams CDN videos to the browser — no 6MB cap, no base64 overhead.
// Handles large clips (100MB+) by piping the upstream body directly.

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

// Verify Firebase ID token via accounts:lookup — same mechanism as all other
// SHOTBREAK functions (lib/auth.js verifyToken). Simple and battle-tested.
async function verifyFirebaseToken(token) {
  const apiKey = Netlify.env.get('FIREBASE_API_KEY');
  if (!apiKey) throw new Error('FIREBASE_API_KEY not set');
  const r = await fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + apiKey,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    }
  );
  const d = await r.json();
  if (!r.ok || !d.users?.[0]) throw new Error('invalid token');
  return d.users[0];
}

// ── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'POST required' });

  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return json(401, { error: 'Login required' });

  try {
    await verifyFirebaseToken(token);
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

