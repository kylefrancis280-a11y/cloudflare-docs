// ═══════════════════════════════════════════════════════════════════════════
//  SHOTBREAK — Character Studio
//  Generates character reference images via fal.ai Flux models.
//
//  POST /.netlify/functions/generate-character
//  Headers:  Authorization: Bearer <HMAC-owner-token | firebase-idToken>
//  Body:     { action: "generate"|"models", model?, prompt, width?, height?, aspect_ratio? }
//
//  ENV VARS:
//    FAL_KEY             — fal.ai API key
//    FIREBASE_API_KEY
//    FIREBASE_PROJECT_ID
//    SYSTEM_EMAIL / SYSTEM_PASSWORD
//    OWNER_EMAILS        — comma-separated list of owner email addresses
//    OWNER_TOKEN_SECRET  — used by verify-owner.js
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const MODELS = {
  'flux-schnell': { endpoint: 'https://fal.run/fal-ai/flux/schnell',    label: 'Flux Schnell', minTier: 'creator', credits: 5  },
  'flux-dev':     { endpoint: 'https://fal.run/fal-ai/flux/dev',         label: 'Flux Dev',     minTier: 'creator', credits: 15 },
  'flux-pro':     { endpoint: 'https://fal.run/fal-ai/flux-2-pro',       label: 'Flux 2 Pro',   minTier: 'studio',  credits: 20 },
};

const TIERS = {
  free:       { rank: 0 },
  creator:    { rank: 1 },
  studio:     { rank: 2 },
  production: { rank: 3 },
  enterprise: { rank: 4 },
  owner:      { rank: 5 },
};

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type':                 'application/json',
};

function respond(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

const FIRESTORE_BASE = () =>
  `https://firestore.googleapis.com/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

// ── System-token cache ──────────────────────────────────────────────────
let _systemTokenCache = { token: null, expires: 0 };
async function getSystemToken() {
  const now = Date.now();
  if (_systemTokenCache.token && _systemTokenCache.expires > now + 60_000) {
    return _systemTokenCache.token;
  }
  const email    = process.env.SYSTEM_EMAIL;
  const password = process.env.SYSTEM_PASSWORD;
  if (!email || !password) throw new Error('SYSTEM_EMAIL / SYSTEM_PASSWORD not set');
  const r = await fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + process.env.FIREBASE_API_KEY,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const d = await r.json();
  if (!r.ok || !d.idToken) throw new Error('SYSTEM_AUTH_FAIL: ' + JSON.stringify(d));
  _systemTokenCache = {
    token:   d.idToken,
    expires: now + (parseInt(d.expiresIn || '3600', 10) * 1000),
  };
  return d.idToken;
}

function rawTokenFromEvent(event) {
  return ((event.headers.authorization || event.headers.Authorization || '')
    .replace(/^Bearer\s+/i, '')).trim();
}

async function verifyToken(event) {
  const tk = rawTokenFromEvent(event);
  if (!tk) throw new Error('NO_TOKEN');
  if (tk.startsWith('owner:')) {
    const { verifyOwnerToken } = require('./verify-owner');
    const verified = verifyOwnerToken(tk);
    if (!verified) throw new Error('BAD_OWNER_TOKEN');
    return { uid: 'owner_' + verified.name, isOwner: true };
  }
  const OWNER_EMAIL_SET = new Set(
    (process.env.OWNER_EMAILS || 'kyle@shotbreak.io,scott@shotbreak.io,steve@shotbreak.io')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  );
  const r = await fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + process.env.FIREBASE_API_KEY,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: tk }),
    }
  );
  const d = await r.json();
  if (!r.ok || !d.users?.[0]) throw new Error('BAD_TOKEN');
  const u = d.users[0];
  const email = (u.email || '').toLowerCase();
  const isOwner = OWNER_EMAIL_SET.has(email);
  return { uid: u.localId, email: u.email, isOwner };
}

async function readUser(uid) {
  const token = await getSystemToken();
  const r = await fetch(
    `${FIRESTORE_BASE()}/users/${uid}`,
    { headers: { Authorization: 'Bearer ' + token } }
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('READ_FAIL_' + r.status);
  const d = await r.json();
  if (!d?.fields) return null;
  const out = {};
  for (const [k, v] of Object.entries(d.fields)) {
    if (v.integerValue !== undefined) out[k] = parseInt(v.integerValue, 10);
    else if (v.stringValue !== undefined) out[k] = v.stringValue;
  }
  return out;
}

async function setCredits(uid, newCredits) {
  const token = await getSystemToken();
  const r = await fetch(
    `${FIRESTORE_BASE()}/users/${uid}?updateMask.fieldPaths=credits`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ fields: { credits: { integerValue: String(Math.floor(newCredits)) } } }),
    }
  );
  if (!r.ok) throw new Error('WRITE_FAIL_' + r.status);
}

// ── Handler ─────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(204, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'POST only' });

  const FAL = process.env.FAL_KEY;
  if (!FAL) return respond(500, { error: 'FAL_KEY missing' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Bad JSON' }); }

  const { action } = body;

  if (action === 'models') {
    return respond(200, {
      models: Object.entries(MODELS).map(([id, c]) => ({
        id, label: c.label, minTier: c.minTier, credits: c.credits,
      })),
    });
  }

  if (action === 'generate') {
    let auth;
    try { auth = await verifyToken(event); }
    catch { return respond(401, { error: 'Login required' }); }

    const { model, prompt, width, height, aspect_ratio } = body;
    const cfg = MODELS[model || 'flux-dev'];
    if (!cfg) return respond(400, { error: 'Unknown model' });
    if (!prompt?.trim()) return respond(400, { error: 'Prompt required' });

    // Capture the credit cost we're about to deduct so we can refund exactly
    // that amount on failure — avoids the read-modify-write race in the old code.
    let deductedCredits = 0;

    if (!auth.isOwner) {
      let user;
      try { user = await readUser(auth.uid); }
      catch (e) { return respond(500, { error: 'Account lookup failed: ' + e.message }); }

      if (!user?.tier) return respond(402, { error: 'No subscription', code: 'NO_SUBSCRIPTION' });
      if ((TIERS[user.tier]?.rank || 0) < (TIERS[cfg.minTier]?.rank || 99)) {
        return respond(403, { error: `${cfg.label} requires ${cfg.minTier}`, code: 'TIER_TOO_LOW' });
      }
      const currentCredits = user.credits || 0;
      if (currentCredits < cfg.credits) {
        return respond(402, { error: `Need ${cfg.credits} credits. Have ${currentCredits}.`, code: 'NO_CREDITS' });
      }
      try { await setCredits(auth.uid, currentCredits - cfg.credits); }
      catch (e) { return respond(500, { error: 'Credit deduction failed: ' + e.message }); }
      deductedCredits = cfg.credits;
    }

    try {
      let w = width || 1024, h = height || 1024;
      if (aspect_ratio === '16:9')  { w = 1280; h = 720;  }
      else if (aspect_ratio === '9:16') { w = 720;  h = 1280; }
      else if (aspect_ratio === '4:3')  { w = 1024; h = 768;  }

      const r = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Key ' + FAL,
        },
        body: JSON.stringify({ prompt, image_size: { width: w, height: h }, num_images: 1 }),
      });
      const d = await r.json();

      if (!r.ok) {
        if (!auth.isOwner && deductedCredits > 0) {
          // Refund exact amount deducted — no re-read needed.
          const current = (await readUser(auth.uid).catch(() => null))?.credits || 0;
          await setCredits(auth.uid, current + deductedCredits).catch(() => {});
        }
        return respond(502, { error: 'Image gen failed. Credits refunded.', detail: d?.message || d?.error || d });
      }

      return respond(200, {
        image_url: d?.images?.[0]?.url || null,
        model,
        charged: auth.isOwner ? 0 : deductedCredits,
      });
    } catch (e) {
      if (!auth.isOwner && deductedCredits > 0) {
        const current = (await readUser(auth.uid).catch(() => null))?.credits || 0;
        await setCredits(auth.uid, current + deductedCredits).catch(() => {});
      }
      return respond(502, { error: 'Network error. Credits refunded.', detail: e.message });
    }
  }

  return respond(400, { error: 'Unknown action' });
};
