// ═══════════════════════════════════════════════════════════════════════════
//  SHOTBREAK — Shared auth + Firestore helpers
//  Used by: agent-invoke.js, agent-orchestrate.js, generate-video.js,
//           generate-character.js
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const FIRESTORE_BASE = () =>
  `https://firestore.googleapis.com/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

// ── System-token cache ──────────────────────────────────────────────────
// Token is good for 1 hour. Refresh 60s before expiry so we never pass an
// expired token to Firestore.
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

// ── Token extraction ────────────────────────────────────────────────────
function rawTokenFromEvent(event) {
  return ((event.headers.authorization || event.headers.Authorization || '')
    .replace(/^Bearer\s+/i, '')).trim();
}

// ── Firebase token verification ─────────────────────────────────────────
// Supports both the legacy HMAC owner token and Firebase idTokens.
// Returns { uid, email?, isOwner, tier? }.
async function verifyToken(event) {
  const tk = rawTokenFromEvent(event);
  if (!tk) throw new Error('NO_TOKEN');

  if (tk.startsWith('owner:')) {
    const { verifyOwnerToken } = require('../verify-owner');
    const verified = verifyOwnerToken(tk);
    if (!verified) throw new Error('BAD_OWNER_TOKEN');
    return { uid: 'owner_' + verified.name, isOwner: true, tier: 'owner', name: verified.name };
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
  if (!r.ok || !d.users || !d.users[0]) throw new Error('BAD_TOKEN');
  const u = d.users[0];
  const email   = (u.email || u.providerUserInfo?.[0]?.email || '').trim().toLowerCase();
  const isOwner = OWNER_EMAIL_SET.has(email);
  return { uid: u.localId, email: u.email, isOwner, tier: isOwner ? 'owner' : undefined };
}

// ── Firestore user reads/writes via SYSTEM token ────────────────────────
async function readUser(uid) {
  const token = await getSystemToken();
  const r = await fetch(
    `${FIRESTORE_BASE()}/users/${uid}`,
    { headers: { Authorization: 'Bearer ' + token } }
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('READ_FAIL_' + r.status);
  const d = await r.json();
  const f = d.fields || {};
  return {
    tier:    f.tier?.stringValue    || 'free',
    credits: parseInt(f.credits?.integerValue || '0', 10),
  };
}

// Auto-bootstrap a user doc if one doesn't exist. Called right after
// verifyToken so new users always have a clean record on their first request.
// Pass { isOwner: true } to seed an owner record so the UI shows the right
// tier badge — credit math is still skipped at runtime via auth.isOwner.
async function getOrCreateUser(uid, opts = {}) {
  const existing = await readUser(uid);
  if (existing) return existing;

  const isOwner     = !!opts.isOwner;
  const seedTier    = isOwner ? 'owner'  : 'free';
  const seedCredits = isOwner ? 999999   : 0;

  const token = await getSystemToken();
  await fetch(
    `${FIRESTORE_BASE()}/users?documentId=${uid}`,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          tier:      { stringValue: seedTier },
          credits:   { integerValue: String(seedCredits) },
          createdAt: { timestampValue: new Date().toISOString() },
        },
      }),
    }
  );
  return { tier: seedTier, credits: seedCredits };
}

async function setCredits(uid, newCredits) {
  const token = await getSystemToken();
  const r = await fetch(
    `${FIRESTORE_BASE()}/users/${uid}?updateMask.fieldPaths=credits`,
    {
      method: 'PATCH',
      headers: {
        Authorization:  'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: { credits: { integerValue: String(Math.max(0, Math.floor(newCredits))) } },
      }),
    }
  );
  if (!r.ok) throw new Error('WRITE_FAIL_' + r.status);
}

module.exports = { getSystemToken, rawTokenFromEvent, verifyToken, readUser, getOrCreateUser, setCredits };
