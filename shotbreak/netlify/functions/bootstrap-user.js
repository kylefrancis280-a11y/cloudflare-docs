// ═══════════════════════════════════════════════════════════════════════════
//  SHOTBREAK — Bootstrap User
//  Called by the frontend immediately after sign-in. Creates the user's
//  Firestore doc if it doesn't exist yet, seeded with the right tier:
//    - Owner emails  → tier: owner,  credits: 999999
//    - Everyone else → tier: free,   credits: 0
//
//  Idempotent: re-calling for an existing user just returns the current state.
//
//  POST /.netlify/functions/bootstrap-user
//  Headers: Authorization: Bearer <firebase-idToken>
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const { verifyToken, getOrCreateUser } = require('./lib/auth');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type':                 'application/json',
};

function respond(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(204, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'POST only' });

  let auth;
  try { auth = await verifyToken(event); }
  catch (e) { return respond(401, { error: e.message || 'AUTH_FAIL' }); }

  let user;
  try { user = await getOrCreateUser(auth.uid, { isOwner: auth.isOwner }); }
  catch (e) { return respond(500, { error: 'Bootstrap failed: ' + e.message }); }

  return respond(200, {
    ok:       true,
    uid:      auth.uid,
    email:    auth.email,
    tier:     user.tier,
    credits:  user.credits,
    isOwner:  auth.isOwner,
  });
};
