// ═══════════════════════════════════════════════════════════════════════════
//  SHOTBREAK — Agent Job Status (poll endpoint)
//  Pairs with agent-invoke-background.js.
//
//  GET /.netlify/functions/agent-invoke-status?job=JOB_ID
//  Headers: Authorization: Bearer <token>
//
//  Returns:
//    { status: "pending"|"running"|"complete"|"error", output?, error?, ... }
//
//  The job_id the client provides must match the format generated in
//  agent-invoke-background.js: "${uid}_${clientJobId}". The status endpoint
//  verifies the auth token and confirms resource.data.uid == requester's uid
//  before returning — so users can only poll their own jobs.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const { verifyToken, getSystemToken } = require('./lib/auth');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type':                 'application/json',
};

function respond(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

const FIRESTORE_BASE = () =>
  `https://firestore.googleapis.com/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

async function readJob(docId) {
  const token = await getSystemToken();
  const r = await fetch(`${FIRESTORE_BASE()}/agent_jobs/${docId}`, {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('JOB_READ_FAIL_' + r.status);
  const d = await r.json();
  const f = d.fields || {};

  function unpack(v) {
    if (!v) return null;
    if ('stringValue'  in v) {
      // Try to parse JSON strings back to objects (output, etc.)
      try { return JSON.parse(v.stringValue); } catch { return v.stringValue; }
    }
    if ('integerValue' in v) return parseInt(v.integerValue, 10);
    if ('booleanValue' in v) return v.booleanValue;
    if ('nullValue'    in v) return null;
    return null;
  }

  return {
    uid:               unpack(f.uid),
    agent_id:          unpack(f.agent_id),
    status:            unpack(f.status) || 'pending',
    output:            unpack(f.output),
    raw:               unpack(f.raw),
    parse_error:       unpack(f.parse_error),
    error:             unpack(f.error),
    credits_charged:   unpack(f.credits_charged),
    credits_remaining: unpack(f.credits_remaining),
    is_owner:          unpack(f.is_owner),
    model_used:        unpack(f.model_used),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(204, {});
  if (event.httpMethod !== 'GET') return respond(405, { error: 'GET only' });

  const clientJobId = (event.queryStringParameters || {}).job;
  if (!clientJobId) return respond(400, { error: 'job query param required' });

  let auth;
  try { auth = await verifyToken(event); }
  catch (e) { return respond(401, { error: e.message || 'AUTH_FAIL' }); }

  // Reconstruct the server-side doc id the same way the background function does.
  const docId = `${auth.uid}_${String(clientJobId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)}`;

  let job;
  try { job = await readJob(docId); }
  catch (e) { return respond(500, { error: 'Job lookup failed: ' + e.message }); }

  // Not created yet (background function hasn't started) → report pending.
  if (!job) return respond(200, { status: 'pending', job_id: clientJobId });

  // Owners can access any job; regular users can only access their own.
  if (!auth.isOwner && job.uid !== auth.uid) {
    return respond(403, { error: 'Forbidden' });
  }

  return respond(200, {
    job_id:            clientJobId,
    status:            job.status,
    agent_id:          job.agent_id,
    output:            job.output,
    raw:               job.raw,
    parse_error:       job.parse_error,
    error:             job.error,
    credits_charged:   job.credits_charged,
    credits_remaining: job.credits_remaining,
    is_owner:          job.is_owner,
    model_used:        job.model_used,
  });
};
