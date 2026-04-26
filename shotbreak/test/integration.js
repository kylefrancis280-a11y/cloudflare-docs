// SHOTBREAK integration test suite — exercises full request cycles with realistic
// upstream responses, real HMAC signatures, and the full background-function flow.
//
// Run: node test/integration.js   (from shotbreak/ directory)
// Requires Node ≥20. No npm install needed — all deps are built-in or mocked.

process.env.FIREBASE_API_KEY      = 'fake-api-key';
process.env.FIREBASE_PROJECT_ID   = 'sb-test';
process.env.SYSTEM_EMAIL          = 'sys@test';
process.env.SYSTEM_PASSWORD       = 'pw';
process.env.OWNER_TOKEN_SECRET    = 'a'.repeat(48);
process.env.OWNER_EMAILS          = 'owner@test';
process.env.OWNER_PW_KYLE         = 'kylepw';
process.env.ANTHROPIC_API_KEY     = 'sk-test';
process.env.WAVESPEED_API_KEY     = 'wstest';
process.env.FAL_KEY               = 'faltest';
process.env.STRIPE_SECRET_KEY     = 'sk_live_test';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_testsecret';

const crypto = require('crypto');
const path   = require('path');
const ROOT   = path.resolve(__dirname, '..');

// ── In-memory Firestore + system-token state ──────────────────────────
const firestoreState = { users: {}, agent_jobs: {} };
let systemTokenIssued = false;

global.fetch = async (url, opts = {}) => {
  const u      = String(url);
  const method = (opts.method || 'GET').toUpperCase();

  // Firebase Identity: signInWithPassword (system token)
  if (u.includes('signInWithPassword')) {
    systemTokenIssued = true;
    return mkJsonRes(200, { idToken: 'sys-token-' + Date.now(), expiresIn: '3600' });
  }

  // Firebase Identity: lookup (verify user idToken)
  if (u.includes('accounts:lookup')) {
    const body = JSON.parse(opts.body || '{}');
    if (body.idToken === 'owner-real-token') return mkJsonRes(200, { users: [{ localId: 'owner_uid', email: 'owner@test' }] });
    if (body.idToken === 'user-real-token')  return mkJsonRes(200, { users: [{ localId: 'user_uid',  email: 'user@test'  }] });
    return mkJsonRes(401, { error: { message: 'invalid token' } });
  }

  // Firestore: read user
  const userMatch = u.match(/\/users\/([^/?]+)/);
  if (userMatch && method === 'GET') {
    const uid = userMatch[1];
    if (firestoreState.users[uid]) {
      return mkJsonRes(200, {
        fields: {
          tier:    { stringValue:  firestoreState.users[uid].tier },
          credits: { integerValue: String(firestoreState.users[uid].credits) },
        },
      });
    }
    return mkJsonRes(404, {});
  }

  // Firestore: create user (POST /users?documentId=UID)
  if (u.includes('/users?documentId=') && method === 'POST') {
    const uid  = (u.match(/documentId=([^&]+)/) || [])[1];
    const body = JSON.parse(opts.body || '{}');
    firestoreState.users[uid] = {
      tier:    body.fields?.tier?.stringValue        || 'free',
      credits: parseInt(body.fields?.credits?.integerValue || '0', 10),
    };
    return mkJsonRes(200, body);
  }

  // Firestore: PATCH user (credit update)
  if (userMatch && method === 'PATCH') {
    const uid  = userMatch[1];
    const body = JSON.parse(opts.body || '{}');
    if (body.fields?.credits?.integerValue !== undefined) {
      firestoreState.users[uid] = firestoreState.users[uid] || { tier: 'free', credits: 0 };
      firestoreState.users[uid].credits = parseInt(body.fields.credits.integerValue, 10);
    }
    return mkJsonRes(200, body);
  }

  // Firestore: agent_jobs PATCH
  const jobMatch = u.match(/\/agent_jobs\/([^/?]+)/);
  if (jobMatch && method === 'PATCH') {
    const jobId = jobMatch[1];
    const body  = JSON.parse(opts.body || '{}');
    firestoreState.agent_jobs[jobId] = firestoreState.agent_jobs[jobId] || {};
    for (const [k, v] of Object.entries(body.fields || {})) {
      if (v.stringValue    !== undefined) firestoreState.agent_jobs[jobId][k] = v.stringValue;
      if (v.integerValue   !== undefined) firestoreState.agent_jobs[jobId][k] = parseInt(v.integerValue, 10);
      if (v.booleanValue   !== undefined) firestoreState.agent_jobs[jobId][k] = v.booleanValue;
      if (v.timestampValue !== undefined) firestoreState.agent_jobs[jobId][k] = v.timestampValue;
    }
    return mkJsonRes(200, body);
  }

  // Firestore: agent_jobs GET
  if (jobMatch && method === 'GET') {
    const jobId = jobMatch[1];
    if (!firestoreState.agent_jobs[jobId]) return mkJsonRes(404, {});
    const fields = {};
    for (const [k, v] of Object.entries(firestoreState.agent_jobs[jobId])) {
      if (typeof v === 'number')       fields[k] = { integerValue: String(v) };
      else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
      else                             fields[k] = { stringValue: String(v) };
    }
    return mkJsonRes(200, { fields });
  }

  // Anthropic: return a realistic JSON-shaped response
  if (u.includes('api.anthropic.com')) {
    return {
      ok: true, status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({
        content: [{ type: 'text', text: '```json\n{"agent_plan":[{"agent_id":"scene-architect"}],"vision_statement":"a tense thriller"}\n```' }],
        usage:   { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 80, cache_read_input_tokens: 0 },
      }),
    };
  }

  // WaveSpeed: submit → request_id; result → video URL
  if (u.includes('wavespeed.ai')) {
    if (method === 'POST') return mkJsonRes(200, { data: { id: 'ws_req_123' } });
    if (u.includes('/result')) return mkJsonRes(200, { data: { status: 'completed', outputs: ['https://cdn.example.com/video.mp4'] } });
  }

  // fal.ai: image generation
  if (u.includes('fal.run')) {
    return mkJsonRes(200, { images: [{ url: 'https://cdn.example.com/img.png' }] });
  }

  return mkJsonRes(500, { error: 'unhandled mock url: ' + u });
};

function mkJsonRes(status, body) {
  return {
    ok:      status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json:    async () => body,
    text:    async () => JSON.stringify(body),
  };
}

// ── Test runner ───────────────────────────────────────────────────────
let passed = 0, failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}: ${e.message}`);
    failed++;
  }
}

function assertEq(actual, expected, msg) {
  if (actual !== expected)
    throw new Error(`${msg || 'assertEq'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ─────────────────────────────────────────────────────────────────────
(async () => {

// ═══════════════════════════════════════════════════════════════════════
//  [1] bootstrap-user
// ═══════════════════════════════════════════════════════════════════════
console.log('\n[1] Bootstrap user flow');

await test('first call creates a free user doc', async () => {
  delete firestoreState.users.user_uid;
  const { handler } = require(path.join(ROOT, 'netlify/functions/bootstrap-user.js'));
  const res  = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer user-real-token' }, body: '{}' });
  const body = JSON.parse(res.body);
  assertEq(res.statusCode, 200, 'status');
  assertEq(body.tier, 'free');
  assertEq(body.credits, 0);
  assertEq(body.isOwner, false);
  if (!firestoreState.users.user_uid) throw new Error('doc was not created');
});

await test('owner gets owner tier + 999999 credits on first call', async () => {
  delete firestoreState.users.owner_uid;
  const { handler } = require(path.join(ROOT, 'netlify/functions/bootstrap-user.js'));
  const res  = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer owner-real-token' }, body: '{}' });
  const body = JSON.parse(res.body);
  assertEq(body.tier, 'owner');
  assertEq(body.credits, 999999);
  assertEq(body.isOwner, true);
});

await test('idempotent: re-calling preserves existing doc', async () => {
  firestoreState.users.user_uid = { tier: 'creator', credits: 250 };
  const { handler } = require(path.join(ROOT, 'netlify/functions/bootstrap-user.js'));
  const res  = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer user-real-token' }, body: '{}' });
  const body = JSON.parse(res.body);
  assertEq(body.tier, 'creator', 'preserved tier');
  assertEq(body.credits, 250,    'preserved credits');
});

// ═══════════════════════════════════════════════════════════════════════
//  [2] Stripe webhook signature verification
// ═══════════════════════════════════════════════════════════════════════
console.log('\n[2] Stripe webhook signature');

await test('valid HMAC signature verifies', async () => {
  delete require.cache[require.resolve(path.join(ROOT, 'netlify/functions/stripe-webhook.js'))];
  const { handler } = require(path.join(ROOT, 'netlify/functions/stripe-webhook.js'));
  const payload = JSON.stringify({ type: 'unknown.event', data: { object: {} } });
  const ts  = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${ts}.${payload}`).digest('hex');
  const res = await handler({
    httpMethod: 'POST',
    headers:    { 'stripe-signature': `t=${ts},v1=${sig}` },
    body:       payload,
  });
  assertEq(res.statusCode, 200, 'accepted valid signature');
  assertEq(JSON.parse(res.body).received, true);
});

await test('rejects forged signature', async () => {
  const { handler } = require(path.join(ROOT, 'netlify/functions/stripe-webhook.js'));
  const ts = Math.floor(Date.now() / 1000);
  const res = await handler({
    httpMethod: 'POST',
    headers:    { 'stripe-signature': `t=${ts},v1=forged_sig_${'x'.repeat(58)}` },
    body:       '{}',
  });
  assertEq(res.statusCode, 400);
});

await test('rejects expired signature (>5min old)', async () => {
  const { handler } = require(path.join(ROOT, 'netlify/functions/stripe-webhook.js'));
  const oldTs = Math.floor(Date.now() / 1000) - 600;
  const sig   = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${oldTs}.{}`).digest('hex');
  const res   = await handler({
    httpMethod: 'POST',
    headers:    { 'stripe-signature': `t=${oldTs},v1=${sig}` },
    body:       '{}',
  });
  assertEq(res.statusCode, 400, 'old signature rejected');
});

// ═══════════════════════════════════════════════════════════════════════
//  [3] agent-invoke — credit flow
// ═══════════════════════════════════════════════════════════════════════
console.log('\n[3] Agent-invoke credit flow');

await test('non-owner with credits: deducts and returns output', async () => {
  firestoreState.users.user_uid = { tier: 'creator', credits: 1000 };
  const { handler } = require(path.join(ROOT, 'netlify/functions/agent-invoke.js'));
  const res  = await handler({
    httpMethod: 'POST',
    headers:    { authorization: 'Bearer user-real-token' },
    body:       JSON.stringify({ agent_id: 'auteur', input: 'a thriller about a missing dog' }),
  });
  assertEq(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assertEq(body.ok, true);
  assertEq(body.credits_charged, 50, 'auteur costs 50');
  assertEq(firestoreState.users.user_uid.credits, 950, 'credits deducted');
});

await test('owner: free call, no deduction', async () => {
  firestoreState.users.owner_uid = { tier: 'owner', credits: 999999 };
  const { handler } = require(path.join(ROOT, 'netlify/functions/agent-invoke.js'));
  const res  = await handler({
    httpMethod: 'POST',
    headers:    { authorization: 'Bearer owner-real-token' },
    body:       JSON.stringify({ agent_id: 'auteur', input: 'test' }),
  });
  assertEq(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assertEq(body.credits_charged, 0);
  assertEq(body.is_owner, true);
});

await test('insufficient credits → 402', async () => {
  firestoreState.users.user_uid = { tier: 'free', credits: 5 };
  const { handler } = require(path.join(ROOT, 'netlify/functions/agent-invoke.js'));
  const res = await handler({
    httpMethod: 'POST',
    headers:    { authorization: 'Bearer user-real-token' },
    body:       JSON.stringify({ agent_id: 'auteur', input: 'x' }),
  });
  assertEq(res.statusCode, 402);
});

await test('new user auto-bootstrapped via getOrCreateUser → 402', async () => {
  delete firestoreState.users.user_uid;
  const { handler } = require(path.join(ROOT, 'netlify/functions/agent-invoke.js'));
  const res = await handler({
    httpMethod: 'POST',
    headers:    { authorization: 'Bearer user-real-token' },
    body:       JSON.stringify({ agent_id: 'auteur', input: 'x' }),
  });
  assertEq(res.statusCode, 402, 'auto-bootstrapped to free → 402 not raw error');
  if (!firestoreState.users.user_uid) throw new Error('doc was not auto-created');
});

// ═══════════════════════════════════════════════════════════════════════
//  [4] agent-orchestrate full_crew mode
// ═══════════════════════════════════════════════════════════════════════
console.log('\n[4] Orchestrate full_crew');

await test('owner: full_crew returns crew + showrunner', async () => {
  firestoreState.users.owner_uid = { tier: 'owner', credits: 999999 };
  const { handler } = require(path.join(ROOT, 'netlify/functions/agent-orchestrate.js'));
  const res  = await handler({
    httpMethod: 'POST',
    headers:    { authorization: 'Bearer owner-real-token' },
    body:       JSON.stringify({ mode: 'full_crew', input: 'space heist short film' }),
  });
  assertEq(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assertEq(body.mode, 'full_crew');
  if (!Array.isArray(body.crew) || body.crew.length === 0) throw new Error('no crew results');
  if (!body.showrunner) throw new Error('no showrunner result');
  assertEq(body.is_owner, true);
});

// ═══════════════════════════════════════════════════════════════════════
//  [5] Background function + status polling
// ═══════════════════════════════════════════════════════════════════════
console.log('\n[5] Background function + status poll');

await test('background fn writes job doc; status returns complete', async () => {
  firestoreState.users.user_uid = { tier: 'creator', credits: 1000 };
  delete firestoreState.agent_jobs['user_uid_testjob1'];

  const { handler: bgHandler }     = require(path.join(ROOT, 'netlify/functions/agent-invoke-background.js'));
  const { handler: statusHandler } = require(path.join(ROOT, 'netlify/functions/agent-invoke-status.js'));

  await bgHandler({
    httpMethod: 'POST',
    headers:    { authorization: 'Bearer user-real-token' },
    body:       JSON.stringify({ agent_id: 'auteur', input: 'test', job_id: 'testjob1' }),
  });

  const statusRes = await statusHandler({
    httpMethod:            'GET',
    headers:               { authorization: 'Bearer user-real-token' },
    queryStringParameters: { job: 'testjob1' },
  });
  assertEq(statusRes.statusCode, 200);
  const body = JSON.parse(statusRes.body);
  assertEq(body.status, 'complete');
  assertEq(body.agent_id, 'auteur');
  if (!body.output) throw new Error('no output in completed job');
});

await test('cross-user job isolation: another user sees pending, not the job', async () => {
  const { handler: statusHandler } = require(path.join(ROOT, 'netlify/functions/agent-invoke-status.js'));
  const res  = await statusHandler({
    httpMethod:            'GET',
    headers:               { authorization: 'Bearer owner-real-token' },
    queryStringParameters: { job: 'testjob1' },
  });
  assertEq(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assertEq(body.status, 'pending', 'owner cannot read user_uid\'s job');
});

// ═══════════════════════════════════════════════════════════════════════
//  [6] generate-video WaveSpeed cycle
// ═══════════════════════════════════════════════════════════════════════
console.log('\n[6] Generate-video WaveSpeed cycle');

await test('submit returns request_id', async () => {
  firestoreState.users.owner_uid = { tier: 'owner', credits: 999999 };
  const { handler } = require(path.join(ROOT, 'netlify/functions/generate-video.js'));
  const res  = await handler({
    httpMethod: 'POST',
    headers:    { authorization: 'Bearer owner-real-token' },
    body:       JSON.stringify({ action: 'submit', model: 'seedance-turbo', prompt: 'a dog runs' }),
  });
  assertEq(res.statusCode, 200);
  assertEq(JSON.parse(res.body).request_id, 'ws_req_123');
});

await test('result fetch returns video URL', async () => {
  const { handler } = require(path.join(ROOT, 'netlify/functions/generate-video.js'));
  const res  = await handler({
    httpMethod: 'POST',
    headers:    { authorization: 'Bearer owner-real-token' },
    body:       JSON.stringify({ action: 'result', request_id: 'ws_req_123' }),
  });
  assertEq(JSON.parse(res.body).video_url, 'https://cdn.example.com/video.mp4');
});

// ═══════════════════════════════════════════════════════════════════════
//  [7] Owner HMAC token (legacy path)
// ═══════════════════════════════════════════════════════════════════════
console.log('\n[7] Owner token (legacy HMAC path)');

await test('verify-owner issues a valid token', async () => {
  delete require.cache[require.resolve(path.join(ROOT, 'netlify/functions/verify-owner.js'))];
  const { handler } = require(path.join(ROOT, 'netlify/functions/verify-owner.js'));
  const res  = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ name: 'kyle', password: 'kylepw' }) });
  assertEq(res.statusCode, 200);
  const body = JSON.parse(res.body);
  if (!body.token || !body.token.startsWith('owner:')) throw new Error('bad token shape: ' + body.token);
});

await test('issued HMAC owner token is accepted by agent-invoke', async () => {
  delete require.cache[require.resolve(path.join(ROOT, 'netlify/functions/verify-owner.js'))];
  const { handler: verify } = require(path.join(ROOT, 'netlify/functions/verify-owner.js'));
  const tokRes = await verify({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ name: 'kyle', password: 'kylepw' }) });
  const { token } = JSON.parse(tokRes.body);

  const { handler: invoke } = require(path.join(ROOT, 'netlify/functions/agent-invoke.js'));
  const res  = await invoke({
    httpMethod: 'POST',
    headers:    { authorization: 'Bearer ' + token },
    body:       JSON.stringify({ agent_id: 'auteur', input: 'test' }),
  });
  assertEq(res.statusCode, 200, 'HMAC owner token accepted');
  assertEq(JSON.parse(res.body).is_owner, true);
});

// ─────────────────────────────────────────────────────────────────────
console.log(`\n${passed}/${passed + failed} tests passed`);
process.exit(failed > 0 ? 1 : 0);

})();
