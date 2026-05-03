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

const { getStore }    = require('@netlify/blobs');
const { verifyToken } = require('./lib/auth');

const CORS = {
  'Access-Control-Allow-Origin':  'https://shotbreak.io',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type':                 'application/json',
};

function respond(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

async function readJob(docId) {
  let store;
  try { store = getStore({ name: 'agent_jobs', consistency: 'strong' }); }
  catch (e) { throw new Error('Blobs unavailable: ' + e.message); }
  const raw = await store.get(docId);
  if (!raw) return null;
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); }
  catch (_) { return null; }  // corrupted blob — treat as not found
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(204, {});
  if (event.httpMethod !== 'GET') return respond(405, { error: 'GET only' });

  const clientJobId = (event.queryStringParameters || {}).job;
  if (!clientJobId) return respond(400, { error: 'job query param required' });

  let auth;
  try { auth = await verifyToken(event); }
  catch (e) { return respond(401, { error: e.message || 'AUTH_FAIL' }); }

  // Reconstruct the server-side blob key the same way the background function does.
  const docId = `${auth.uid}_${String(clientJobId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)}`;

  let job;
  try { job = await readJob(docId); }
  catch (e) {
    console.error('SB_STATUS_READ_FAIL', e.message);
    return respond(500, { error: 'Job lookup failed: ' + e.message });
  }

  // Job not found — return 404 to avoid leaking existence via brute-force enumeration.
  if (!job) return respond(404, { error: 'Job not found' });

  // Owners can access any job; regular users can only access their own.
  if (!auth.isOwner && job.uid !== auth.uid) {
    return respond(403, { error: 'Forbidden' });
  }

  return respond(200, {
    job_id:            clientJobId,
    status:            job.status || 'pending',
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
