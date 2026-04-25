// ═══════════════════════════════════════════════════════════════════════════
//  SHOTBREAK — Agent Client (frontend, 50-agent crew)
//  Exposes window.SB_Agents. Auto-generates AGENT_META from registry at build
//  time so it never drifts from the server side.
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const INVOKE_URL       = '/.netlify/functions/agent-invoke';                  // sync path (26s budget)
  const START_URL        = '/.netlify/functions/agent-invoke-background';       // background (15-min budget)
  const STATUS_URL       = '/.netlify/functions/agent-invoke-status';           // job poll
  const ORCHESTRATE_URL  = '/.netlify/functions/agent-orchestrate';
  const BOOTSTRAP_URL    = '/.netlify/functions/bootstrap-user';                // create user doc on first login

  // Polling config — exponential backoff from 1s → 5s, max 5 min wait
  const POLL_INITIAL_MS   = 1000;
  const POLL_MAX_MS       = 5000;
  const POLL_BACKOFF      = 1.4;
  const POLL_TIMEOUT_MS   = 5 * 60 * 1000;

  // Full 50-agent metadata mirror. Must match registry.js exactly.
  // Fields: id, name, wing, tier, manager, credits.
  const AGENT_META = [
    // ── TIER 1 — MANAGERS (15) ──
    { id: 'vision-director',         name: 'The Vision Director',         wing: 'directors',  tier: 1, credits: 50, manages: ['genre-specialist'] },
    { id: 'story-director',          name: 'The Story Director',          wing: 'directors',  tier: 1, credits: 50, manages: ['beat-analyst','continuity-supervisor'] },
    { id: 'visual-director',         name: 'The Visual Director',         wing: 'directors',  tier: 1, credits: 50, manages: ['cinematographer','movement-choreographer','color-theorist','colorist'] },
    { id: 'dialogue-writer',         name: 'The Dialogue Writer',         wing: 'writers',    tier: 1, credits: 50, manages: ['dialogue-coach','cliche-detector'] },
    { id: 'action-writer',           name: 'The Action Writer',           wing: 'writers',    tier: 1, credits: 50, manages: ['script-doctor','script-formatter','subtext-writer'] },
    { id: 'prompt-writer',           name: 'The Prompt Writer',           wing: 'writers',    tier: 1, credits: 50, manages: ['prompt-smith','scene-architect','shot-calibrator'] },
    { id: 'visual-character-builder',name: 'The Visual Character Builder',wing: 'characters', tier: 1, credits: 50, manages: ['character-sculptor','wardrobe-props'] },
    { id: 'psychological-builder',   name: 'The Psychological Builder',   wing: 'characters', tier: 1, credits: 50, manages: ['emotion-mapper'] },
    { id: 'voice-builder',           name: 'The Voice Builder',           wing: 'characters', tier: 1, credits: 50, manages: ['voice-consistency-auditor','adr-supervisor'] },
    { id: 'environment-builder',     name: 'The Environment Builder',     wing: 'settings',   tier: 1, credits: 50, manages: ['location-scout','architecture-designer'] },
    { id: 'atmospherics-builder',    name: 'The Atmospherics Builder',    wing: 'settings',   tier: 1, credits: 50, manages: ['lighting-designer','weather-coordinator','sound-designer'] },
    { id: 'dressing-builder',        name: 'The Dressing Builder',        wing: 'settings',   tier: 1, credits: 50, manages: ['props-master','set-dresser','vfx-supervisor'] },
    { id: 'timeline-editor',         name: 'The Timeline Editor',         wing: 'editors',    tier: 1, credits: 50, manages: ['editor','transition-designer'] },
    { id: 'pacing-editor',           name: 'The Pacing Editor',           wing: 'editors',    tier: 1, credits: 50, manages: ['pacing-doctor','runtime-calculator'] },
    { id: 'assembly-editor',         name: 'The Assembly Editor',         wing: 'editors',    tier: 1, credits: 50, manages: ['trailer-cutter','polish-pass','music-supervisor'] },

    // ── TIER 2 — SPECIALISTS (35) ──
    { id: 'genre-specialist',        name: 'Genre Specialist',        wing: 'directors',  tier: 2, manager: 'vision-director',           credits: 5  },
    { id: 'beat-analyst',            name: 'Beat Analyst',            wing: 'directors',  tier: 2, manager: 'story-director',            credits: 15 },
    { id: 'continuity-supervisor',   name: 'Continuity Supervisor',   wing: 'directors',  tier: 2, manager: 'story-director',            credits: 15 },
    { id: 'cinematographer',         name: 'Cinematographer',         wing: 'directors',  tier: 2, manager: 'visual-director',           credits: 15 },
    { id: 'movement-choreographer',  name: 'Movement Choreographer',  wing: 'directors',  tier: 2, manager: 'visual-director',           credits: 5  },
    { id: 'color-theorist',          name: 'Color Theorist',          wing: 'directors',  tier: 2, manager: 'visual-director',           credits: 5  },
    { id: 'colorist',                name: 'Colorist',                wing: 'directors',  tier: 2, manager: 'visual-director',           credits: 5  },
    { id: 'dialogue-coach',          name: 'Dialogue Coach',          wing: 'writers',    tier: 2, manager: 'dialogue-writer',           credits: 15 },
    { id: 'cliche-detector',         name: 'Cliche Detector',         wing: 'writers',    tier: 2, manager: 'dialogue-writer',           credits: 5  },
    { id: 'script-doctor',           name: 'Script Doctor',           wing: 'writers',    tier: 2, manager: 'action-writer',             credits: 15 },
    { id: 'script-formatter',        name: 'Script Formatter',        wing: 'writers',    tier: 2, manager: 'action-writer',             credits: 5  },
    { id: 'subtext-writer',          name: 'Subtext Writer',          wing: 'writers',    tier: 2, manager: 'action-writer',             credits: 15 },
    { id: 'prompt-smith',            name: 'Prompt Smith',            wing: 'writers',    tier: 2, manager: 'prompt-writer',             credits: 5  },
    { id: 'scene-architect',         name: 'Scene Architect',         wing: 'writers',    tier: 2, manager: 'prompt-writer',             credits: 20 },
    { id: 'shot-calibrator',         name: 'Shot Calibrator',         wing: 'writers',    tier: 2, manager: 'prompt-writer',             credits: 5  },
    { id: 'character-sculptor',      name: 'Character Sculptor',      wing: 'characters', tier: 2, manager: 'visual-character-builder',  credits: 20 },
    { id: 'wardrobe-props',          name: 'Wardrobe & Props',        wing: 'characters', tier: 2, manager: 'visual-character-builder',  credits: 15 },
    { id: 'emotion-mapper',          name: 'Emotion Mapper',          wing: 'characters', tier: 2, manager: 'psychological-builder',     credits: 5  },
    { id: 'voice-consistency-auditor', name: 'Voice Consistency Auditor', wing: 'characters', tier: 2, manager: 'voice-builder',         credits: 5  },
    { id: 'adr-supervisor',          name: 'ADR Supervisor',          wing: 'characters', tier: 2, manager: 'voice-builder',             credits: 5  },
    { id: 'location-scout',          name: 'Location Scout',          wing: 'settings',   tier: 2, manager: 'environment-builder',       credits: 15 },
    { id: 'architecture-designer',   name: 'Architecture Designer',   wing: 'settings',   tier: 2, manager: 'environment-builder',       credits: 5  },
    { id: 'lighting-designer',       name: 'Lighting Designer',       wing: 'settings',   tier: 2, manager: 'atmospherics-builder',      credits: 15 },
    { id: 'weather-coordinator',     name: 'Weather Coordinator',     wing: 'settings',   tier: 2, manager: 'atmospherics-builder',      credits: 5  },
    { id: 'sound-designer',          name: 'Sound Designer',          wing: 'settings',   tier: 2, manager: 'atmospherics-builder',      credits: 15 },
    { id: 'props-master',            name: 'Props Master',            wing: 'settings',   tier: 2, manager: 'dressing-builder',          credits: 5  },
    { id: 'set-dresser',             name: 'Set Dresser',             wing: 'settings',   tier: 2, manager: 'dressing-builder',          credits: 5  },
    { id: 'vfx-supervisor',          name: 'VFX Supervisor',          wing: 'settings',   tier: 2, manager: 'dressing-builder',          credits: 15 },
    { id: 'editor',                  name: 'Editor',                  wing: 'editors',    tier: 2, manager: 'timeline-editor',           credits: 20 },
    { id: 'transition-designer',     name: 'Transition Designer',     wing: 'editors',    tier: 2, manager: 'timeline-editor',           credits: 5  },
    { id: 'pacing-doctor',           name: 'Pacing Doctor',           wing: 'editors',    tier: 2, manager: 'pacing-editor',             credits: 5  },
    { id: 'runtime-calculator',      name: 'Runtime Calculator',      wing: 'editors',    tier: 2, manager: 'pacing-editor',             credits: 5  },
    { id: 'trailer-cutter',          name: 'Trailer Cutter',          wing: 'editors',    tier: 2, manager: 'assembly-editor',           credits: 15 },
    { id: 'polish-pass',             name: 'Polish Pass',             wing: 'editors',    tier: 2, manager: 'assembly-editor',           credits: 5  },
    { id: 'music-supervisor',        name: 'Music Supervisor',        wing: 'editors',    tier: 2, manager: 'assembly-editor',           credits: 5  },
  ];

  // Legacy aliases (old code used 'auteur' / 'showrunner')
  const LEGACY_ALIASES = { auteur: 'vision-director', showrunner: 'assembly-editor' };
  function resolveId(id) { return LEGACY_ALIASES[id] || id; }

  async function getAuthToken() {
    if (typeof window.getToken === 'function') return window.getToken();
    if (window.SB_OWNER_TOKEN) return window.SB_OWNER_TOKEN;
    if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
      return firebase.auth().currentUser.getIdToken();
    }
    return null;
  }
  async function authHeaders() {
    const tk = await getAuthToken();
    if (!tk) throw new Error('Not logged in. Sign in to SHOTBREAK before using the crew.');
    return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tk };
  }
  async function post(url, body) {
    const headers = await authHeaders();
    // Client timeout = 32s. Server-side architecture (v81): Sonnet 17s →
    // Haiku 8s fallback → ~1s parsing + network = ~26s server total at the
    // worst case (Netlify Pro ceiling). A few extra seconds of network
    // latency on top can push real wall-clock to 28-30s on bad connections.
    // 32s gives the server its full Haiku-rescue path room to land before
    // the browser gives up. Was 30s in v80, was tripping during stall→
    // fallback exactly when we needed it most.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 32000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const raw = await res.text();
      let data; try { data = JSON.parse(raw); }
      catch { throw new Error('Non-JSON response (' + res.status + '): ' + raw.slice(0, 300)); }
      if (!res.ok) {
        const err = new Error(data.error || ('HTTP ' + res.status));
        err.detail = data; err.status = res.status; throw err;
      }
      return data;
    } catch (e) {
      if (e.name === 'AbortError') {
        const timeoutErr = new Error('Agent timed out after 32 seconds — backend stalled twice (Sonnet + Haiku). Try again or check status.anthropic.com.');
        timeoutErr.code = 'TIMEOUT';
        throw timeoutErr;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  async function get(url) {
    const headers = await authHeaders();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 32000);
    try {
      const res = await fetch(url, { method: 'GET', headers, signal: ctrl.signal });
      const raw = await res.text();
      let data; try { data = JSON.parse(raw); }
      catch { throw new Error('Non-JSON response (' + res.status + '): ' + raw.slice(0, 300)); }
      if (!res.ok) {
        const err = new Error(data.error || ('HTTP ' + res.status));
        err.detail = data; err.status = res.status; throw err;
      }
      return data;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Request timed out after 32 seconds');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Synchronous invocation (DEMO PATH) ───────────────────────────────
  // Calls /agent-invoke directly, waits for response. No Firestore needed.
  // Owners bypass credit check entirely — function returns in 5-20s.
  async function invokeSync(agentId, input, opts) {
    opts = opts || {};
    const data = await post(INVOKE_URL, {
      agent_id: resolveId(agentId),
      input,
      context:  opts.context || null,
    });
    // Return the same shape as the polling path so workflow.js is agnostic.
    return {
      ok:                data.ok !== false,
      agent_id:          data.agent_id,
      output:            data.output || data.result,
      result:            data.output || data.result,
      raw:               data.raw,
      parse_error:       data.parse_error,
      credits_charged:   data.credits_charged || 0,
      credits_remaining: data.credits_remaining || 0,
      is_owner:          data.is_owner,
    };
  }

  // ── Background invocation (15-minute budget) ────────────────────────
  // Generates a job_id client-side, fires the background function (gets 202
  // immediately from Netlify), then polls the status endpoint until done.
  // Returns the same shape as invokeSync so workflow.js is agnostic.
  async function invokeWithPolling(agentId, input, opts) {
    opts = opts || {};

    // Generate a unique job id. crypto.randomUUID() is available in all
    // modern browsers; fall back to a timestamp+random combo if not.
    const jobId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2);

    // Fire background function — Netlify returns 202 immediately, function
    // runs in background. We don't await the response body.
    const headers = await authHeaders();
    fetch(START_URL, {
      method:  'POST',
      headers,
      body:    JSON.stringify({ agent_id: resolveId(agentId), input, context: opts.context || null, job_id: jobId }),
    }).catch(() => {}); // network errors are surfaced via polling timeout, not here

    // Poll status with exponential backoff.
    const statusUrlFor = (id) => `${STATUS_URL}?job=${encodeURIComponent(id)}`;
    const t0 = Date.now();
    let delay = POLL_INITIAL_MS;

    while (true) {
      if (Date.now() - t0 > POLL_TIMEOUT_MS) {
        const e = new Error('Job polling timed out after 5 minutes');
        e.status = 408; e.detail = { job_id: jobId };
        throw e;
      }
      await new Promise(r => setTimeout(r, delay));

      let status;
      try { status = await get(statusUrlFor(jobId)); }
      catch (e) {
        if (e.status === 401 || e.status === 403) throw e;
        delay = Math.min(delay * POLL_BACKOFF, POLL_MAX_MS);
        continue;
      }

      if (status.status === 'complete') {
        return {
          ok:                true,
          agent_id:          status.agent_id,
          output:            status.output,
          result:            status.output,
          raw:               status.raw,
          parse_error:       status.parse_error,
          credits_charged:   status.credits_charged  || 0,
          credits_remaining: status.credits_remaining || 0,
          is_owner:          status.is_owner,
          job_id:            jobId,
        };
      }
      if (status.status === 'error') {
        const e = new Error(status.error || 'Agent job failed');
        e.status = 502;
        e.detail = { detail: status.error, job_id: jobId, agent_id: status.agent_id };
        throw e;
      }
      // pending / running → keep polling
      delay = Math.min(delay * POLL_BACKOFF, POLL_MAX_MS);
    }
  }

  const SB_Agents = {
    invoke(agentId, input, opts = {}) {
      // DEMO PATH: use the synchronous /agent-invoke endpoint. Owners bypass
      // credit checks and never hit Firestore. Works within the 26s Netlify
      // Pro timeout — single Anthropic call typically completes in 5-15s.
      // This avoids the entire Firestore job-queue dependency.
      return invokeSync(agentId, input, opts);
    },
    // Available if you need background/long-running path (requires Firestore)
    invokePolling(agentId, input, opts = {}) {
      return invokeWithPolling(agentId, input, opts);
    },
    // Legacy sync invoke - same as .invoke() but named explicitly
    invokeSync(agentId, input, opts = {}) {
      return invokeSync(agentId, input, opts);
    },
    // Orchestration modes (unchanged)
    auteurPlan(brief)                     { return post(ORCHESTRATE_URL, { mode: 'auteur_plan', input: brief }); },
    showrunnerCut(timelineExport)         { return post(ORCHESTRATE_URL, { mode: 'showrunner_cut', timeline: timelineExport, input: 'review timeline' }); },
    fullProduction(brief, timelineExport) { return post(ORCHESTRATE_URL, { mode: 'full_production', input: brief, timeline: timelineExport || null }); },
    customChain(input, chain)             { return post(ORCHESTRATE_URL, { mode: 'custom_chain', input, chain: chain.map(resolveId) }); },
    runFullCrew(projectInput)             { return post(ORCHESTRATE_URL, { mode: 'full_crew', input: projectInput }); },

    // Call once after Firebase sign-in. Idempotent: creates the user's
    // Firestore doc if missing (free tier for new users, owner tier for
    // whitelisted emails) and returns the current { tier, credits, isOwner }.
    // Safe to call on every page load — caches the result for the session.
    async bootstrap() {
      if (window._sbBootstrapCache) return window._sbBootstrapCache;
      try {
        const data = await post(BOOTSTRAP_URL, {});
        window._sbBootstrapCache = data;
        return data;
      } catch (e) {
        // Non-fatal — auth flow can recover by retrying on the first agent call.
        console.warn('[SB_Agents.bootstrap] failed:', e.message);
        return null;
      }
    },

    // UI helpers
    agents()               { return AGENT_META.slice(); },
    agentsByWing(wing)     { return AGENT_META.filter(a => a.wing === wing); },
    agentsByTier(tier)     { return AGENT_META.filter(a => a.tier === tier); },
    agentsByManager(mid)   { return AGENT_META.filter(a => a.manager === mid); },
    agentMeta(id)          { return AGENT_META.find(a => a.id === resolveId(id)) || null; },

    managers() { return AGENT_META.filter(a => a.tier === 1); },
    specialists() { return AGENT_META.filter(a => a.tier === 2); },
    wings() { return ['directors', 'writers', 'characters', 'settings', 'editors']; },

    // Fast lookup by id (for crew UI credit totals + display labels).
    // Built once at module load.
    AGENTS_LOOKUP: AGENT_META.reduce((acc, a) => { acc[a.id] = a; return acc; }, {}),
  };

  window.SB_Agents = SB_Agents;
})();
