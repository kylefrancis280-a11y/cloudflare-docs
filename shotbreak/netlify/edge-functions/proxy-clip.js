// SHOTBREAK — WaveSpeed clip proxy (Edge Function)
// Streams CDN videos to the browser — no 6MB cap, no base64 overhead.
// Handles large clips (100MB+) by piping the upstream body directly.
//
// Supports BOTH:
//   POST { url }  + Authorization: Bearer <idToken>      (editor fetch())
//   GET  ?u=<url>&t=<idToken>                            (<video src>, <a download>)
// The GET form is required because <video> elements and <a download> cannot
// set request headers, so the auth token has to ride in the query string.

const CORS = {
  'Access-Control-Allow-Origin': 'https://shotbreak.io',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function verifyFirebaseToken(token) {
  const apiKey = Netlify.env.get('FIREBASE_API_KEY');
  if (!apiKey) throw new Error('FIREBASE_API_KEY not set');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(
      'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + apiKey,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: token }),
        signal: ctrl.signal,
      }
    );
    const d = await r.json();
    if (!r.ok || !d.users?.[0]) throw new Error('invalid token');
    return d.users[0];
  } finally {
    clearTimeout(timer);
  }
}

const ALLOWED = /^https:\/\/([a-z0-9][a-z0-9-]*\.)*wavespeed\.ai\//i;

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  let url, token;
  if (req.method === 'GET') {
    const u = new URL(req.url);
    url = u.searchParams.get('u') || u.searchParams.get('url') || '';
    token = u.searchParams.get('t') || u.searchParams.get('token') || '';
  } else if (req.method === 'POST') {
    const auth = req.headers.get('Authorization') || '';
    token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    let body;
    try { body = await req.json(); }
    catch { return json(400, { error: 'Invalid JSON' }); }
    url = body?.url || '';
  } else {
    return json(405, { error: 'GET or POST required' });
  }

  if (!token) return json(401, { error: 'Login required' });
  try { await verifyFirebaseToken(token); }
  catch { return json(401, { error: 'Login required' });   }

  if (!url || typeof url !== 'string') return json(400, { error: 'url required' });
  if (!ALLOWED.test(url)) return json(403, { error: 'URL not from an allowed domain' });

  // Forward Range header so <video> seek works and Safari plays at all.
  const upstreamHeaders = {};
  const range = req.headers.get('Range');
  if (range) upstreamHeaders['Range'] = range;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);

  let upstream;
  try {
    upstream = await fetch(url, { headers: upstreamHeaders, signal: ctrl.signal });
  } catch (e) {
    clearTimeout(timer);
    return json(502, { error: 'Proxy fetch failed: ' + e.message });
  }

  // Don't fail on 206 — that's the success case for ranged requests.
  if (!upstream.ok && upstream.status !== 206) {
    clearTimeout(timer);
    return json(upstream.status === 404 ? 404 : 502, {
      error: 'CDN fetch failed: HTTP ' + upstream.status,
    });
  }

  const ct = upstream.headers.get('content-type') || 'video/mp4';
  const headers = {
    ...CORS,
    'Content-Type': ct,
    'Cache-Control': 'public, max-age=3600',
    'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes',
  };
  const cl = upstream.headers.get('content-length');
  if (cl) headers['Content-Length'] = cl;
  const cr = upstream.headers.get('content-range');
  if (cr) headers['Content-Range'] = cr;
  const lm = upstream.headers.get('last-modified');
  if (lm) headers['Last-Modified'] = lm;
  const etag = upstream.headers.get('etag');
  if (etag) headers['ETag'] = etag;

  // Clear timeout once the response object is built; streaming continues
  // beyond this point and the body is wired straight through.
  clearTimeout(timer);

  return new Response(upstream.body, { status: upstream.status, headers });
}

export const config = { path: '/proxy-clip' };
