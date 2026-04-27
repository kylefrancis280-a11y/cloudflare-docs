// ═══════════════════════════════════════════════════════════════════════════
//  SHOTBREAK — Agent Invocation (single-agent)
//  Mirrors generate-video.js auth + credit logic exactly. No Admin SDK.
//
//  POST /.netlify/functions/agent-invoke
//  Headers:  Authorization: Bearer <HMAC-owner-token | firebase-idToken>
//  Body:     { agent_id, input, context? }
//
//  ENV VARS (all already configured for SHOTBREAK):
//    FIREBASE_API_KEY
//    FIREBASE_PROJECT_ID
//    OWNER_TOKEN_SECRET     (used by verify-owner.js)
//    SYSTEM_EMAIL           (system account for server-authorised Firestore writes)
//    SYSTEM_PASSWORD
//    ANTHROPIC_API_KEY      (new — already added per Step 2)
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const { getAgent }                                    = require('../../agents/registry');
const { verifyToken, getOrCreateUser, setCredits }    = require('./lib/auth');

const ANTHROPIC_URL     = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const VALID_DEDUCTIONS = new Set([5, 15, 20, 50, 75, 150, 250]);

const CORS = {
  'Access-Control-Allow-Origin':  'https://shotbreak.io',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type':                 'application/json',
};

function respond(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

// ── Anthropic call ──────────────────────────────────────────────────────
async function callAnthropic(agent, input, context) {
  const userMessage =
    typeof input === 'string' ? input : JSON.stringify(input, null, 2);

  // Cap context payload at 60KB. After Story + Cast + Coverage crews run,
  // the raw crew_analysis blob can exceed 150KB which balloons Anthropic
  // input tokens + slows responses. For each key, if its serialized size
  // exceeds 15KB we truncate it with a note rather than dropping it entirely.
  let trimmedContext = context;
  if (context && typeof context === 'object') {
    const KEY_CAP = 15 * 1024;  // per-key cap in chars
    trimmedContext = {};
    for (const [k, v] of Object.entries(context)) {
      const s = JSON.stringify(v);
      if (s.length <= KEY_CAP) {
        trimmedContext[k] = v;
      } else {
        // Too big — keep it as a truncated string instead of omitting.
        // Downstream agents still get signal, just not the full dump.
        trimmedContext[k] = {
          _truncated: true,
          _original_size: s.length,
          _preview: s.slice(0, KEY_CAP) + '…[truncated]',
        };
      }
    }
  }
  const contextualBrief = trimmedContext
    ? `\n\n[CONTEXT FROM UPSTREAM AGENTS]\n${JSON.stringify(trimmedContext, null, 2)}`
    : '';

  const body = {
    model:      agent.model,
    // Managers: 900 tokens (forces tight JSON, finishes in ~8-12s).
    // Specialists: 700 tokens default (tighter schemas, finishes in ~5-8s).
    // Per-agent override via agent.max_tokens — applied for known-large
    // outputs (scene-architect, shot-calibrator, visual-character-builder,
    // etc.) where the 700 ceiling was truncating responses mid-stream and
    // producing parse errors. Values chosen to fit under the 22s specialist
    // timeout even at the 150-200 tok/sec Sonnet emission rate.
    max_tokens: agent.max_tokens || (agent.tier === 1 ? 900 : 700),
    system: [
      {
        type: 'text',
        text: agent.systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: `${userMessage}${contextualBrief}` }],
  };

  // Retry logic for 429 (rate limit) and 529 (overloaded). These are
  // transient — during a 12-agent crew run we can burst the Anthropic API
  // and get throttled briefly. Keep retries tight to stay under 26s
  // Netlify Pro sync timeout. With 2 retries + 500ms/1s backoff, worst case
  // is ~22s (10s attempt + 0.5s wait + 10s attempt = budget-safe).
  //
  // Each individual fetch gets a 20s abort timeout. Without it, a hung
  // Anthropic connection (rare but possible) would silently burn the entire
  // Netlify timeout and return 502 to the client with no context.
  //
  // Two-tier timeout strategy on the Netlify 26s ceiling:
  //   · Sonnet primary: 15s. Covers managers with max_tokens up to 2000
  //     (1500 tok @ 150 tok/s = ~10s gen + ~2s TTFT = ~12s — fits cleanly).
  //     Stalled pods get cut 2s faster than the old 17s, handing off to Haiku
  //     with 11s remaining instead of 9s.
  //   · Haiku fallback: ~10.5s (set dynamically below). Haiku at 450 tok/s
  //     generates 2000 tokens in ~4.5s, so 2 retries fit easily.
  //   · Total: ~25.5s with ~0.5s safety margin.
  // If you need longer Sonnet calls, raise SONNET_TIMEOUT_MS — but you'll
  // also need to drop FALLBACK_MIN_BUDGET_MS proportionally or move to
  // a background-function architecture.
  const SONNET_TIMEOUT_MS = 15000;

  // ULTRA-AGGRESSIVE FALLBACK (v64):
  //   · 1 attempt on Sonnet 4.6 (15s limit)
  //   · If 429/529/503/stall: flip to Haiku 4.5 immediately (different infra)
  //   · On Haiku: 2 retries with 1s/2s backoff, ~10.5s budget
  //   · Total Sonnet time budget: ~one call (~10s typical for 1500-token mgrs)
  //   · Total Haiku budget: ~11s remaining
  // This fails fast on dying Sonnet instead of burning 3 retries * 10s each.
  const FALLBACK_MODEL = 'claude-haiku-4-5-20251001';
  let res, raw;
  let currentModel = agent.model;
  let fellBack = false;

  async function tryModel(modelToUse, maxRetries, timeoutMs) {
    const effectiveTimeout = timeoutMs || SONNET_TIMEOUT_MS;
    let attempt = 0;
    const localBody = { ...body, model: modelToUse };
    while (true) {
      const abortCtrl = new AbortController();
      const abortTimer = setTimeout(() => abortCtrl.abort(), effectiveTimeout);
      try {
        const r = await fetch(ANTHROPIC_URL, {
          method: 'POST',
          headers: {
            'x-api-key':          process.env.ANTHROPIC_API_KEY,
            'anthropic-version':  ANTHROPIC_VERSION,
            'anthropic-beta':     'prompt-caching-2024-07-31',
            'Content-Type':       'application/json',
          },
          body:   JSON.stringify(localBody),
          signal: abortCtrl.signal,
        });
        clearTimeout(abortTimer);
        if (r.status !== 429 && r.status !== 529 && r.status !== 503) return r;
        attempt++;
        if (attempt > maxRetries) return r;
        const retryAfter = parseInt(r.headers.get('retry-after') || '0', 10);
        const backoffMs = Math.min(2000, 1000 * attempt);
        const delay = (retryAfter > 0 && retryAfter < 3)
          ? retryAfter * 1000
          : backoffMs;
        await new Promise(r => setTimeout(r, delay));
      } catch (e) {
        clearTimeout(abortTimer);
        if (e.name === 'AbortError') {
          // Convert timeout into a stall signal the caller can detect and
          // route to Haiku fallback. Previously this was a hard throw, so
          // a stalled (non-erroring) Sonnet pod meant the request died
          // entirely. Now we surface it as a sentinel "stalled" response
          // and let the orchestration layer flip models.
          return { _stalled: true, status: 599, headers: { get: () => null } };
        }
        throw e;
      }
    }
  }

  // Track wall-clock so Haiku's budget fits within what's left of the Netlify
  // 26s function ceiling. If Sonnet ate 25s stalling, we have ~1s left — not
  // enough; we'd rather just throw a clean error than spawn a doomed Haiku
  // call. Anything > 8s remaining is enough for Haiku (it generates ~3x
  // faster than Sonnet) so it's worth attempting.
  const callStart = Date.now();
  const NETLIFY_BUDGET_MS = 26000;
  const FALLBACK_MIN_BUDGET_MS = 8000;

  // Try Sonnet ONCE. If it returns an overload code OR stalled out, flip to Haiku.
  res = await tryModel(currentModel, 0);

  const sonnetStalled = res._stalled === true;
  const sonnetOverloaded = res.status === 429 || res.status === 529 || res.status === 503;

  if (sonnetStalled || sonnetOverloaded) {
    const elapsed = Date.now() - callStart;
    const remaining = NETLIFY_BUDGET_MS - elapsed;
    if (remaining < FALLBACK_MIN_BUDGET_MS) {
      // Not enough budget for Haiku — surface a clear error rather than a
      // spawn-and-die.
      throw new Error(`Anthropic Sonnet stalled and only ${Math.round(remaining/1000)}s remaining for Haiku fallback (need ${FALLBACK_MIN_BUDGET_MS/1000}s minimum). Try again — usually succeeds on retry.`);
    }
    console.log(JSON.stringify({
      tag: 'SB_FALLBACK',
      ts: new Date().toISOString(),
      agent_id: agent.id,
      primary_status: res.status,
      reason: sonnetStalled ? 'sonnet_stalled_using_haiku' : 'sonnet_overloaded_using_haiku',
      remaining_ms: remaining,
    }));
    currentModel = FALLBACK_MODEL;
    fellBack = true;
    // Give Haiku the remaining budget minus a 500ms safety margin for
    // response parsing + any back-pressure.
    const haikuBudget = Math.max(FALLBACK_MIN_BUDGET_MS, remaining - 500);
    // 2 retries on Haiku (its own pod might also be busy). With 12s Sonnet
    // timeout we now have ~13.5s for Haiku — enough for 3 attempts at 4s each.
    res = await tryModel(FALLBACK_MODEL, 2, haikuBudget);
    if (res._stalled === true) {
      throw new Error(`Anthropic stalled on both Sonnet and Haiku — agent ${agent.id} timed out twice. Anthropic may be experiencing a major incident; check status.anthropic.com.`);
    }
  }

  // Text-first parsing — matches SHOTBREAK's established pattern for
  // handling non-JSON error responses from upstream APIs.
  raw = await res.text();
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error(`Anthropic returned non-JSON (${res.status}): ${raw.slice(0, 500)}`); }

  if (!res.ok) {
    const msg = parsed.error?.message || raw;
    if (res.status === 429) throw new Error(`Anthropic rate-limited even after Haiku fallback — please wait 30 seconds and try again.`);
    if (res.status === 529) throw new Error(`Anthropic servers are overloaded (both Sonnet + Haiku). Wait 30 seconds and retry. Check status.anthropic.com for incident reports.`);
    if (res.status === 503) throw new Error(`Anthropic service unavailable. Wait 60 seconds and retry.`);
    throw new Error(`Anthropic error (${res.status}): ${msg}`);
  }

  const textBlocks = (parsed.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');

  let structured = null;
  let parseError = null;
  if (agent.outputFormat === 'json') {
    const cleaned = textBlocks.replace(/```json\s*|\s*```/g, '').trim();
    try { structured = JSON.parse(cleaned); }
    catch (e) {
      parseError = e.message;
      // Salvage path — when the model's output was truncated mid-stream (ran
      // out of max_tokens before closing the JSON), try to recover whatever
      // complete objects it DID emit. This saves scene-architect from
      // returning nothing usable when we get e.g. 4 complete shots + 1
      // half-written shot. Strategy:
      //   1. Find any top-level array like "shots":[...]
      //   2. Parse complete {...} entries inside it using brace-depth tracking
      //   3. Return as a partial structured object if we recovered anything
      const salvaged = salvagePartialArray(cleaned);
      if (salvaged && salvaged.key && salvaged.items.length) {
        structured = { [salvaged.key]: salvaged.items, _truncated: true, _recovered_count: salvaged.items.length };
        parseError = `${parseError} (salvaged ${salvaged.items.length} complete ${salvaged.key})`;
      }
    }
  }

  return {
    raw:           textBlocks,
    structured,
    parse_error:   parseError,
    usage:         parsed.usage || null,
    model_used:    currentModel,
    fell_back:     fellBack,
  };
}

// ── Partial JSON salvage ────────────────────────────────────────────────
// Given a truncated JSON-ish string like: `{"shots":[{...},{...},{...`
// find the first array-shaped key and extract every complete object in it
// by walking brace depth. Returns { key, items } or null.
//
// Handles strings + escapes so a `{` or `"` inside a quoted value doesn't
// break the depth count. Any object that fails to cleanly close (e.g. the
// last half-emitted one) is dropped.
function salvagePartialArray(text) {
  if (!text || typeof text !== 'string') return null;
  // Find first occurrence of `"<key>":[`
  const m = text.match(/"([a-zA-Z_][a-zA-Z0-9_]*)"\s*:\s*\[/);
  if (!m) return null;
  const key = m[1];
  let i = m.index + m[0].length;
  const items = [];
  // Skip whitespace
  while (i < text.length && /\s/.test(text[i])) i++;
  while (i < text.length) {
    if (text[i] !== '{') break;
    const start = i;
    let depth = 0;
    let inStr = false;
    let escape = false;
    let closed = false;
    while (i < text.length) {
      const ch = text[i];
      if (escape) { escape = false; i++; continue; }
      if (inStr) {
        if (ch === '\\') { escape = true; i++; continue; }
        if (ch === '"') inStr = false;
        i++; continue;
      }
      if (ch === '"') { inStr = true; i++; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { i++; closed = true; break; }
      }
      i++;
    }
    if (!closed) break;  // truncated mid-object — stop salvaging here
    const objText = text.slice(start, i);
    try { items.push(JSON.parse(objText)); } catch (_) { /* malformed, skip */ }
    // Skip comma + whitespace to the next object
    while (i < text.length && /[,\s]/.test(text[i])) i++;
  }
  return items.length ? { key, items } : null;
}

// ── Handler ─────────────────────────────────────────────────────────────
exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return respond(204, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'POST only' });

  // Start timer for telemetry — captures end-to-end duration per agent call.
  const startMs = Date.now();

  // Log helper — writes a single JSON line to Netlify function logs with all
  // the fields an admin dashboard will eventually want. Costs nothing, runs
  // on every call, and gives us historical telemetry even before we build
  // the dashboard. Filter in Netlify logs by searching `"SB_AGENT_LOG"`.
  const logTelemetry = (fields) => {
    try {
      const line = {
        tag:            'SB_AGENT_LOG',
        ts:             new Date().toISOString(),
        duration_ms:    Date.now() - startMs,
        agent_id:       fields.agent_id || null,
        agent_tier:     fields.agent_tier || null,
        uid:            fields.uid || null,
        email:          fields.email || null,
        is_owner:       fields.is_owner || false,
        status:         fields.status,        // 'ok' | 'error' | 'rejected'
        http_status:    fields.http_status || null,
        credits:        fields.credits || 0,
        input_tokens:   fields.input_tokens || null,
        output_tokens:  fields.output_tokens || null,
        parse_error:    fields.parse_error || null,
        error_code:     fields.error_code || null,
        error_msg:      fields.error_msg || null,
      };
      // Single-line JSON for grep-ability in Netlify log viewer.
      console.log(JSON.stringify(line));
    } catch (e) { /* telemetry never breaks the request */ }
  };

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch {
    logTelemetry({ status: 'rejected', http_status: 400, error_code: 'BAD_JSON' });
    return respond(400, { error: 'Invalid JSON body' });
  }

  const { agent_id, input, context } = payload;
  if (!agent_id)           { logTelemetry({ status: 'rejected', http_status: 400, error_code: 'NO_AGENT_ID' }); return respond(400, { error: 'agent_id required' }); }
  if (input === undefined) { logTelemetry({ status: 'rejected', http_status: 400, error_code: 'NO_INPUT', agent_id }); return respond(400, { error: 'input required' }); }

  let agent;
  try { agent = getAgent(agent_id); }
  catch (e) { logTelemetry({ agent_id, status: 'rejected', http_status: 404, error_code: 'AGENT_NOT_FOUND', error_msg: e.message }); return respond(404, { error: e.message }); }

  if (!VALID_DEDUCTIONS.has(agent.credits)) {
    logTelemetry({ agent_id, agent_tier: agent.tier, status: 'error', http_status: 500, error_code: 'INVALID_CREDITS', credits: agent.credits });
    return respond(500, {
      error: `Agent credit cost ${agent.credits} is not a valid Firestore deduction amount`,
    });
  }

  // Auth
  let auth;
  try { auth = await verifyToken(event); }
  catch (e) { logTelemetry({ agent_id, agent_tier: agent.tier, status: 'rejected', http_status: 401, error_code: 'AUTH_FAIL', error_msg: e.message }); return respond(401, { error: e.message || 'AUTH_FAIL' }); }

  // Credit pre-check (customers only; owners skip)
  let userCredits = 0;
  if (!auth.isOwner) {
    let user;
    try { user = await getOrCreateUser(auth.uid); }
    catch (e) { logTelemetry({ agent_id, agent_tier: agent.tier, uid: auth.uid, email: auth.email, status: 'error', http_status: 500, error_code: 'CREDIT_LOOKUP_FAIL', error_msg: e.message }); return respond(500, { error: 'Credit lookup failed: ' + e.message }); }
    userCredits = user?.credits || 0;
    if (userCredits < agent.credits) {
      logTelemetry({ agent_id, agent_tier: agent.tier, uid: auth.uid, email: auth.email, status: 'rejected', http_status: 402, error_code: 'INSUFFICIENT_CREDITS', credits: agent.credits });
      return respond(402, {
        error:             'Insufficient credits',
        required:          agent.credits,
        available:         userCredits,
        credits_remaining: userCredits,
      });
    }
    // Deduct BEFORE the call (mirrors generate-video.js); refund on failure.
    try { await setCredits(auth.uid, userCredits - agent.credits); }
    catch (e) { logTelemetry({ agent_id, agent_tier: agent.tier, uid: auth.uid, email: auth.email, status: 'error', http_status: 500, error_code: 'CREDIT_DEDUCT_FAIL', error_msg: e.message }); return respond(500, { error: 'Credit deduction failed: ' + e.message }); }
  }

  // Run the agent
  let result;
  try {
    result = await callAnthropic(agent, input, context);
  } catch (e) {
    if (!auth.isOwner) {
      try { await setCredits(auth.uid, userCredits); } catch (_) {}
    }
    logTelemetry({
      agent_id, agent_tier: agent.tier, uid: auth.uid, email: auth.email, is_owner: auth.isOwner,
      status: 'error', http_status: 502, error_code: 'ANTHROPIC_FAIL', error_msg: e.message,
      credits: auth.isOwner ? 0 : agent.credits,
    });
    return respond(502, { error: 'Agent invocation failed', detail: e.message });
  }

  // Success — log the full stats for this call.
  logTelemetry({
    agent_id, agent_tier: agent.tier, uid: auth.uid, email: auth.email, is_owner: auth.isOwner,
    status:        'ok', http_status: 200,
    credits:       auth.isOwner ? 0 : agent.credits,
    input_tokens:  result.usage?.input_tokens || null,
    output_tokens: result.usage?.output_tokens || null,
    parse_error:   result.parse_error || null,
  });

  return respond(200, {
    ok:                true,
    agent_id,
    agent_name:        agent.name,
    output:            result.structured || result.raw,
    result:            result.structured || result.raw,
    raw:               result.raw,
    parse_error:       result.parse_error,
    credits_charged:   auth.isOwner ? 0 : agent.credits,
    credits_remaining: auth.isOwner ? 999999 : userCredits - agent.credits,
    usage:             result.usage,
    is_owner:          auth.isOwner,
  });
};
