// ═══════════════════════════════════════════════════════════════════════════
//  SHOTBREAK — Agent Orchestration (multi-agent chains)
//  Same auth + credit model as agent-invoke.js. Runs 5 modes:
//    auteur_plan       — 50 credits.  AUTEUR alone; returns execution plan.
//    showrunner_cut    — 50 credits.  SHOWRUNNER alone; returns cut JSON.
//    full_production   — 150 credits. AUTEUR -> planned specialists (parallel) -> SHOWRUNNER.
//    full_crew         — 250 credits. AUTEUR -> ALL 48 agents (parallel) -> SHOWRUNNER.
//    custom_chain      — variable.    Caller specifies the specialist chain (sequential).
//
//  POST /.netlify/functions/agent-orchestrate
//  Headers:  Authorization: Bearer <HMAC-owner-token | firebase-idToken>
//  Body:     { mode, input, chain?, timeline?, context? }
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const { getAgent, AGENTS }                           = require('../../agents/registry');
const { verifyToken, getOrCreateUser, setCredits }   = require('./lib/auth');

const ANTHROPIC_URL     = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const FALLBACK_MODEL    = 'claude-haiku-4-5-20251001';

const VALID_DEDUCTIONS = [5, 15, 20, 50, 75, 150, 250];

const MODE_COSTS = {
  auteur_plan:     50,
  showrunner_cut:  50,
  full_production: 150,
  full_crew:       250,
};

// Per-call Anthropic budget. Sonnet gets 17s; if it stalls/overloads we flip
// to Haiku with whatever time remains. Matches agent-invoke.js strategy.
const SONNET_TIMEOUT_MS       = 17000;
const NETLIFY_BUDGET_MS       = 26000;
const FALLBACK_MIN_BUDGET_MS  = 8000;
// Per-key cap when trimming rolling context to avoid ballooning token counts.
const KEY_CAP_CHARS = 15 * 1024;

const CORS = {
  'Access-Control-Allow-Origin':  'https://shotbreak.io',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type':                 'application/json',
};

function respond(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

function roundUpToValidTier(amount) {
  for (const v of VALID_DEDUCTIONS) if (v >= amount) return v;
  return VALID_DEDUCTIONS[VALID_DEDUCTIONS.length - 1];
}

// ── Partial JSON salvage ────────────────────────────────────────────────
// Recover complete objects from a truncated JSON array string.
function salvagePartialArray(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(/"([a-zA-Z_][a-zA-Z0-9_]*)"\s*:\s*\[/);
  if (!m) return null;
  const key = m[1];
  let i = m.index + m[0].length;
  const items = [];
  while (i < text.length && /\s/.test(text[i])) i++;
  while (i < text.length) {
    if (text[i] !== '{') break;
    const start = i;
    let depth = 0, inStr = false, escape = false, closed = false;
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
      else if (ch === '}') { depth--; if (depth === 0) { i++; closed = true; break; } }
      i++;
    }
    if (!closed) break;
    const objText = text.slice(start, i);
    try { items.push(JSON.parse(objText)); } catch (_) {}
    while (i < text.length && /[,\s]/.test(text[i])) i++;
  }
  return items.length ? { key, items } : null;
}

// ── Context size trimmer ────────────────────────────────────────────────
// Cap rolling context payload to avoid ballooning token counts.
function trimContext(context) {
  if (!context || typeof context !== 'object') return context;
  const out = {};
  for (const [k, v] of Object.entries(context)) {
    const s = JSON.stringify(v);
    if (s.length <= KEY_CAP_CHARS) {
      out[k] = v;
    } else {
      out[k] = { _truncated: true, _original_size: s.length, _preview: s.slice(0, KEY_CAP_CHARS) + '…[truncated]' };
    }
  }
  return out;
}

// ── Anthropic call with Sonnet→Haiku fallback + timeout ────────────────
async function callAnthropic(agent, input, context, callStart) {
  const userMessage = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
  const trimmed = trimContext(context);
  const contextualBrief = trimmed
    ? `\n\n[CONTEXT FROM UPSTREAM AGENTS]\n${JSON.stringify(trimmed, null, 2)}`
    : '';

  const body = {
    model:      agent.model,
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
            'x-api-key':                process.env.ANTHROPIC_API_KEY,
            'anthropic-version':        ANTHROPIC_VERSION,
            'anthropic-beta':           'prompt-caching-2024-07-31',
            'Content-Type':             'application/json',
          },
          body:   JSON.stringify(localBody),
          signal: abortCtrl.signal,
        });
        clearTimeout(abortTimer);
        if (r.status !== 429 && r.status !== 529 && r.status !== 503) return r;
        attempt++;
        if (attempt > maxRetries) return r;
        const retryAfter = parseInt(r.headers.get('retry-after') || '0', 10);
        const backoffMs  = Math.min(2000, 1000 * attempt);
        const delay      = (retryAfter > 0 && retryAfter < 3) ? retryAfter * 1000 : backoffMs;
        await new Promise(res => setTimeout(res, delay));
      } catch (e) {
        clearTimeout(abortTimer);
        if (e.name === 'AbortError') return { _stalled: true, status: 599, headers: { get: () => null } };
        throw e;
      }
    }
  }

  let res;
  let currentModel = agent.model;
  let fellBack = false;

  res = await tryModel(currentModel, 0);

  if (res._stalled || res.status === 429 || res.status === 529 || res.status === 503) {
    const elapsed    = Date.now() - callStart;
    const remaining  = NETLIFY_BUDGET_MS - elapsed;
    if (remaining < FALLBACK_MIN_BUDGET_MS) {
      throw new Error(`Anthropic Sonnet stalled and only ${Math.round(remaining / 1000)}s remaining for Haiku fallback.`);
    }
    console.log(JSON.stringify({
      tag: 'SB_ORCH_FALLBACK', agent_id: agent.id, primary_status: res.status,
      reason: res._stalled ? 'stalled' : 'overloaded', remaining_ms: remaining,
    }));
    currentModel = FALLBACK_MODEL;
    fellBack = true;
    res = await tryModel(FALLBACK_MODEL, 1, Math.max(FALLBACK_MIN_BUDGET_MS, remaining - 500));
    if (res._stalled) throw new Error(`Anthropic stalled on both Sonnet and Haiku — agent ${agent.id} timed out twice.`);
  }

  const raw = await res.text();
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error(`Anthropic returned non-JSON (${res.status}): ${raw.slice(0, 500)}`); }

  if (!res.ok) {
    if (res.status === 429) throw new Error('Anthropic rate-limited even after Haiku fallback. Wait 30s and retry.');
    if (res.status === 529) throw new Error('Anthropic servers overloaded (Sonnet + Haiku). Wait 30s and retry.');
    if (res.status === 503) throw new Error('Anthropic service unavailable. Wait 60s and retry.');
    throw new Error(`Anthropic error (${res.status}): ${parsed.error?.message || raw}`);
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
      const salvaged = salvagePartialArray(cleaned);
      if (salvaged && salvaged.key && salvaged.items.length) {
        structured = { [salvaged.key]: salvaged.items, _truncated: true, _recovered_count: salvaged.items.length };
        parseError = `${parseError} (salvaged ${salvaged.items.length} complete ${salvaged.key})`;
      }
    }
  }

  return { raw: textBlocks, structured, parse_error: parseError, usage: parsed.usage || null, model_used: currentModel, fell_back: fellBack };
}

// ── Chain runner — parallel where possible ──────────────────────────────
// Each specialist gets the seed context (auteur plan) but runs concurrently.
// The showrunner then receives all specialists' outputs at once.
async function runParallelChain(agentIds, input, seedContext, callStart) {
  if (agentIds.length === 0) return { results: [], context: seedContext || {} };

  const results = await Promise.all(
    agentIds.map(async (id) => {
      const agent = getAgent(id);
      const out = await callAnthropic(agent, input, seedContext, callStart);
      return { agent_id: id, agent_name: agent.name, ...out };
    })
  );

  // Merge all outputs into a single context object for the showrunner.
  const mergedContext = { ...(seedContext || {}) };
  for (const r of results) {
    mergedContext[r.agent_id] = r.structured || r.raw;
  }

  return { results, context: mergedContext };
}

// ── Handler ─────────────────────────────────────────────────────────────
exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return respond(204, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'POST only' });

  const callStart = Date.now();

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON body' }); }

  const { mode, input, chain, timeline, context } = payload;
  if (!mode) return respond(400, { error: 'mode required' });

  let cost;
  if (mode === 'custom_chain') {
    if (!Array.isArray(chain) || chain.length === 0) {
      return respond(400, { error: 'chain[] required for custom_chain' });
    }
    let raw = 0;
    try { raw = chain.reduce((n, id) => n + getAgent(id).credits, 0); }
    catch (e) { return respond(404, { error: e.message }); }
    cost = roundUpToValidTier(raw);
  } else if (MODE_COSTS[mode]) {
    cost = MODE_COSTS[mode];
  } else {
    return respond(400, { error: 'Unknown mode: ' + mode });
  }

  let auth;
  try { auth = await verifyToken(event); }
  catch (e) { return respond(401, { error: e.message || 'AUTH_FAIL' }); }

  let userCredits = 0;
  if (!auth.isOwner) {
    let user;
    try { user = await getOrCreateUser(auth.uid); }
    catch (e) { return respond(500, { error: 'Credit lookup failed: ' + e.message }); }
    userCredits = user?.credits || 0;
    if (userCredits < cost) {
      return respond(402, {
        error: 'Insufficient credits', required: cost,
        available: userCredits, credits_remaining: userCredits,
      });
    }
    try { await setCredits(auth.uid, userCredits - cost); }
    catch (e) { return respond(500, { error: 'Credit deduction failed: ' + e.message }); }
  }

  let output;
  try {
    if (mode === 'auteur_plan') {
      const auteur = getAgent('auteur');
      const out = await callAnthropic(auteur, input, context, callStart);
      output = { mode, auteur: out, result: out.structured || out.raw };

    } else if (mode === 'showrunner_cut') {
      const showrunner = getAgent('showrunner');
      const out = await callAnthropic(showrunner, timeline || input, context, callStart);
      output = { mode, showrunner: out, result: out.structured || out.raw };

    } else if (mode === 'full_production') {
      // 1. Auteur builds the execution plan
      const auteur  = getAgent('auteur');
      const plan    = await callAnthropic(auteur, input, context, callStart);
      const rawPlan = Array.isArray(plan.structured?.agent_plan) ? plan.structured.agent_plan : [];
      const specialists = rawPlan
        .map(step => step && typeof step === 'object' ? step.agent_id : step)
        .filter(id => typeof id === 'string')
        .filter(id => {
          const a = AGENTS.find(x => x.id === id);
          return a && a.wing !== 'orchestrator';
        });

      // 2. Run all specialists in PARALLEL with the auteur plan as seed context
      const seedCtx = { auteur_plan: plan.structured || plan.raw };
      const chainResult = specialists.length
        ? await runParallelChain(specialists, input, seedCtx, callStart)
        : { results: [], context: seedCtx };

      // 3. Showrunner synthesizes everything
      const showrunner = getAgent('showrunner');
      const review = await callAnthropic(showrunner, timeline || input, chainResult.context, callStart);

      output = {
        mode,
        auteur:      plan,
        specialists: chainResult.results,
        showrunner:  review,
        result: {
          plan:        plan.structured || plan.raw,
          specialists: chainResult.results.map(r => ({
            agent_id: r.agent_id, agent_name: r.agent_name,
            output: r.structured || r.raw,
          })),
          cut: review.structured || review.raw,
        },
      };

    } else if (mode === 'full_crew') {
      // Run every non-orchestrator agent in parallel — all 48 at once — then
      // showrunner synthesizes the full output. The auteur plan is the shared
      // seed context so every agent starts from the same brief.
      const auteur    = getAgent('auteur');
      const plan      = await callAnthropic(auteur, input, context, callStart);
      const seedCtx   = { auteur_plan: plan.structured || plan.raw };

      const crewIds = AGENTS
        .filter(a => a.wing !== 'orchestrator')
        .map(a => a.id);

      const chainResult = await runParallelChain(crewIds, input, seedCtx, callStart);

      const showrunner = getAgent('showrunner');
      const review     = await callAnthropic(showrunner, timeline || input, chainResult.context, callStart);

      output = {
        mode,
        auteur,
        crew:   chainResult.results,
        showrunner: review,
        result: {
          plan:  plan.structured || plan.raw,
          crew:  chainResult.results.map(r => ({
            agent_id: r.agent_id, agent_name: r.agent_name,
            output: r.structured || r.raw,
          })),
          cut: review.structured || review.raw,
        },
      };

    } else if (mode === 'custom_chain') {
      // Custom chains run sequentially so each agent can build on the previous.
      const results = [];
      let rollingContext = context || {};
      for (const id of chain) {
        const agent = getAgent(id);
        const out   = await callAnthropic(agent, input, rollingContext, callStart);
        results.push({ agent_id: id, agent_name: agent.name, ...out });
        rollingContext = { ...rollingContext, [id]: out.structured || out.raw };
      }
      output = {
        mode, chain,
        results,
        result: results.map(r => ({ agent_id: r.agent_id, output: r.structured || r.raw })),
      };
    }
  } catch (e) {
    if (!auth.isOwner) {
      try { await setCredits(auth.uid, userCredits); } catch (_) {}
    }
    return respond(502, { error: 'Orchestration failed', detail: e.message });
  }

  return respond(200, {
    ok:                true,
    ...output,
    credits_charged:   auth.isOwner ? 0 : cost,
    credits_remaining: auth.isOwner ? 999999 : userCredits - cost,
    is_owner:          auth.isOwner,
  });
};
