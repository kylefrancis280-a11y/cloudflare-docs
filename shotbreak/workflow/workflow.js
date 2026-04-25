// ═══════════════════════════════════════════════════════════════════════════
//  SHOTBREAK — Workflow Controller (v61 — Full Stack Live + Admin Dashboard)
//  One file: state management, hash routing, seven step renderers, all 50
//  agents wired. Every agent call goes through window.SB_Agents with inputs
//  preprocessed by window.SB_Normalize.
// ═══════════════════════════════════════════════════════════════════════════

(function(){
'use strict';

// ── Global error handlers — catch everything the app doesn't handle,
// log clearly to console, and toast the user. Without these, a thrown
// error in any async path silently leaves the UI in a broken state
// with no feedback to the user.
window.addEventListener('error', (e) => {
  console.error('[SB GlobalError]', e.error || e.message, e.filename + ':' + e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[SB UnhandledRejection]', e.reason);
});

// ── Wait for dependencies ─────────────────────────────────────────────
let _bootTries = 0;
function bootWhenReady(){
  if (!window.SB_Agents || !window.SB_Normalize || !window.SB_Appliers || !window.SB_Enricher) {
    if (++_bootTries > 200) { // 10s max (200 × 50ms) — fail loudly, not silently forever
      console.error('[SB] Dependencies failed to load. Check agent script tags.');
      return;
    }
    setTimeout(bootWhenReady, 50);
    return;
  }
  boot();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootWhenReady);
else bootWhenReady();

// ── Storage + state ───────────────────────────────────────────────────
const STORAGE_KEY = 'SB_Projects_v1';
function loadProjects(){
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch(e){ return {}; }
}

// Heuristic: max localStorage budget before we proactively prune.
// Browsers typically give 5-10MB per origin. We stay conservative at 4MB.
const LS_BUDGET_BYTES = 4 * 1024 * 1024;

function getStorageSize(){
  let total = 0;
  for (const k in localStorage) {
    if (Object.prototype.hasOwnProperty.call(localStorage, k)) {
      total += (localStorage[k] || '').length + k.length;
    }
  }
  return total * 2; // UTF-16 bytes
}

// Prune crew_analysis from OLD projects (keep the current project's data).
// Returns bytes freed. We drop crew_analysis first (largest, re-runnable)
// before touching anything structural.
function pruneOldProjects(all, keepId){
  const entries = Object.entries(all)
    .filter(([id]) => id !== keepId)
    .sort((a, b) => (a[1].updated_at || 0) - (b[1].updated_at || 0));
  let freed = 0;
  for (const [id, proj] of entries) {
    if (proj.crew_analysis && Object.keys(proj.crew_analysis).length) {
      const before = JSON.stringify(proj).length;
      delete proj.crew_analysis;
      freed += (before - JSON.stringify(proj).length) * 2;
      if (freed > 1024 * 1024) break; // pruned 1MB+, stop
    }
  }
  return freed;
}

function saveProjects(all, currentId){
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch(e){
    // QuotaExceededError — try pruning old crew analysis first
    const freed = pruneOldProjects(all, currentId);
    if (freed > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
        toast(`Storage was full — pruned old crew analysis to make room (${Math.round(freed/1024)}KB freed).`, 'ok');
        return;
      } catch(e2) { /* fall through */ }
    }
    // Still failing — tell user clearly instead of silently losing data
    toast('Browser storage FULL — delete old projects or export current project before continuing. Your latest changes may NOT be saved.', 'err');
    console.error('[saveProjects] Quota exceeded even after pruning:', e);
  }
}
function getProject(id){ return loadProjects()[id] || null; }
function saveProject(p){
  p.updated_at = Date.now();
  const all = loadProjects();
  all[p.id] = p;
  saveProjects(all, p.id);
}
function deleteProject(id){
  const all = loadProjects(); delete all[id]; saveProjects(all);
}
function newProjectId(){
  return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,6);
}
function newProject(){
  return {
    id: newProjectId(),
    title: 'Untitled project',
    created_at: Date.now(),
    updated_at: Date.now(),
    vision: null,
    script: { raw: '', normalized: null },
    character_bible: {},
    location_library: {},
    shot_list: [],
    clips: {},
    timeline: null,
    step: 1,
  };
}

// ── Auth check ────────────────────────────────────────────────────────
function isSignedIn(){
  if (window.SB_OWNER_TOKEN) return true;
  try { return !!(firebase.auth && firebase.auth().currentUser); } catch(e){ return false; }
}
function currentUserLabel(){
  if (window.SB_OWNER_NAME) return window.SB_OWNER_NAME + ' · owner';
  try {
    const u = firebase.auth && firebase.auth().currentUser;
    if (u) return u.email || u.displayName || 'signed in';
  } catch(e){}
  return '';
}

// Build auth headers for direct backend calls (e.g. /generate-character).
// Owner tokens take precedence; falls back to Firebase ID token. Used by
// the v83 character-reference workflow which talks directly to fal.ai
// rather than through the SB_Agents async-job pipeline.
async function authHeaders(){
  const headers = { 'Content-Type': 'application/json' };
  if (window.SB_OWNER_TOKEN) {
    headers.Authorization = 'Bearer ' + window.SB_OWNER_TOKEN;
    return headers;
  }
  try {
    const u = firebase.auth && firebase.auth().currentUser;
    if (u) headers.Authorization = 'Bearer ' + (await u.getIdToken());
  } catch(e){ /* unauth — backend will reject */ }
  return headers;
}

// ── Toast ─────────────────────────────────────────────────────────────
const $toast = () => document.getElementById('toast');
let toastTimer = null;
function toast(msg, kind){
  const el = $toast(); if (!el) return;
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4500);
}

// ── Router ────────────────────────────────────────────────────────────
function parseRoute(){
  const h = (location.hash || '').replace(/^#\//, '');
  const parts = h.split('/').filter(Boolean);
  return { path: parts, raw: h };
}
function go(path){
  location.hash = '#/' + path;
}
window.addEventListener('hashchange', render);

// ── Agent integration helpers ─────────────────────────────────────────
function showSpinnerOn(btn){
  if (!btn) return () => {};
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Running...';
  return () => { btn.disabled = false; btn.innerHTML = original; };
}

// ── Live crew activity feed ────────────────────────────────────────────
// Pushes one row per agent call so the user SEES the 50-agent crew working.
const CrewFeed = {
  shown: new Map(), // agentId → row element
  errors: new Map(), // agentId → last error message
  started: new Set(),
  completed: new Set(),
  friendlyName(id) {
    const meta = window.SB_Agents?.agentMeta?.(id);
    return meta?.name || id;
  },
  refreshCount() {
    const c = document.getElementById('rail-crew-count');
    if (c) c.textContent = this.completed.size + ' / 50';
  },
  log(agentId, status, errorMessage) {
    const feed = document.getElementById('rail-crew-feed');
    if (!feed) return;
    // Remove the idle text on first activity
    const idle = feed.querySelector('.rail-crew-idle');
    if (idle) idle.remove();

    let row = this.shown.get(agentId);
    if (!row) {
      row = document.createElement('div');
      row.className = 'rail-crew-row';
      row.dataset.agent = agentId;
      row.innerHTML = `
        <span class="rail-crew-status"></span>
        <span class="rail-crew-name">${esc(this.friendlyName(agentId))}</span>
      `;
      feed.prepend(row);
      this.shown.set(agentId, row);
      while (feed.children.length > 12) feed.removeChild(feed.lastChild);
    }
    const statusEl = row.querySelector('.rail-crew-status');
    row.classList.remove('working', 'done', 'err');
    row.classList.add(status);
    if (status === 'working') {
      statusEl.innerHTML = '<span class="rail-crew-spinner"></span>';
      this.started.add(agentId);
    } else if (status === 'done') {
      statusEl.textContent = '✓';
      this.completed.add(agentId);
      this.refreshCount();
      // If there was a previous error banner below this row, clear it
      const prevBanner = row.nextElementSibling;
      if (prevBanner?.classList.contains('rail-crew-err-banner') && prevBanner.dataset.agent === agentId) {
        prevBanner.remove();
      }
      this.errors.delete(agentId);
    } else if (status === 'err') {
      statusEl.textContent = '!';
      if (errorMessage) {
        this.errors.set(agentId, errorMessage);
        row.title = 'Click for error details: ' + errorMessage.slice(0, 120);
        row.style.cursor = 'pointer';
        row.onclick = () => this.showErrorBanner(agentId, row, errorMessage);
      }
    }
  },
  showErrorBanner(agentId, row, message) {
    // Remove any existing banner for this agent
    const next = row.nextElementSibling;
    if (next?.classList.contains('rail-crew-err-banner') && next.dataset.agent === agentId) {
      next.remove(); return;
    }
    // Insert expanding banner right after the row
    const banner = document.createElement('div');
    banner.className = 'rail-crew-err-banner';
    banner.dataset.agent = agentId;
    banner.innerHTML = `
      <div class="rail-crew-err-text">${esc(message)}</div>
      <button class="rail-crew-err-close" type="button" aria-label="Dismiss">×</button>
    `;
    row.after(banner);
    banner.querySelector('.rail-crew-err-close').addEventListener('click', (e) => {
      e.stopPropagation(); banner.remove();
    });
  },
};
window.SB_CrewFeed = CrewFeed;

// Pretty-prints agent output as readable text instead of raw JSON.
// Handles common structured-output shapes from upgraded agents:
//  - plain strings → as-is
//  - arrays of objects → bulleted list of field:value lines
//  - objects with known label fields → formatted K/V
//  - anything else → falls back to indented JSON (never a raw blob)
function formatAgentOutput(output) {
  if (!output) return '(no output)';
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    return output.map((item, i) => {
      if (typeof item === 'string') return `• ${item}`;
      if (item && typeof item === 'object') {
        const lines = Object.entries(item)
          .filter(([k, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length))
          .map(([k, v]) => `  ${k}: ${formatValue(v)}`);
        return `• Item ${i + 1}\n${lines.join('\n')}`;
      }
      return '• ' + String(item);
    }).join('\n\n');
  }
  if (typeof output === 'object') {
    // Special-case common top-level arrays so they get flattened
    const preferredOrder = ['recommended_cut', 'continuity_issues', 'pacing_notes',
                            'audio_notes', 'sign_off', 'sign_off_reason',
                            'edits', 'per_shot', 'per_edge', 'per_scene', 'issues',
                            'current_runtime_seconds', 'target_runtime_seconds',
                            'cue_points', 'bpm_range', 'overall_direction', 'genre',
                            'shots', 'additional_shots', 'warnings'];
    const keys = Object.keys(output);
    keys.sort((a, b) => {
      const ai = preferredOrder.indexOf(a); const bi = preferredOrder.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1; if (bi === -1) return -1;
      return ai - bi;
    });
    const lines = [];
    keys.forEach(k => {
      const v = output[k];
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) return;
      const label = k.replace(/_/g, ' ').toUpperCase();
      if (Array.isArray(v)) {
        lines.push(`${label}:`);
        v.forEach((item, i) => {
          if (typeof item === 'string') lines.push(`  • ${item}`);
          else if (item && typeof item === 'object') {
            const sublines = Object.entries(item)
              .filter(([kk, vv]) => vv != null && vv !== '')
              .map(([kk, vv]) => `    ${kk}: ${formatValue(vv)}`);
            lines.push(`  • (${i + 1})`);
            sublines.forEach(l => lines.push(l));
          } else lines.push('  • ' + String(item));
        });
      } else if (typeof v === 'object') {
        lines.push(`${label}:`);
        Object.entries(v).forEach(([kk, vv]) => {
          if (vv != null && vv !== '') lines.push(`  ${kk}: ${formatValue(vv)}`);
        });
      } else {
        lines.push(`${label}: ${formatValue(v)}`);
      }
      lines.push('');
    });
    return lines.join('\n').trim();
  }
  return String(output);
}

function formatValue(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(formatValue).join(', ');
  if (typeof v === 'object') {
    return Object.entries(v).filter(([, vv]) => vv != null && vv !== '').map(([k, vv]) => `${k}=${formatValue(vv)}`).join('; ');
  }
  return String(v);
}

// Detect transient backend errors that are worth a silent retry. Timeouts,
// 529 overloaded, 503 unavailable, and client-side AbortError all fall in
// this category — the original request is idempotent and a second attempt
// usually succeeds because Anthropic load is bursty. We only retry ONCE
// to keep worst-case latency bounded; the user still sees the final error
// if both attempts fail.
function isTransientAgentError(e) {
  if (!e) return false;
  if (e.code === 'TIMEOUT') return true;
  const msg = String(e.message || '').toLowerCase();
  const detail = String(e.detail?.detail || '').toLowerCase();
  const combined = msg + ' ' + detail;
  if (/timeout|timed out|took too long|abort/i.test(combined)) return true;
  if (/529|overloaded|503|unavailable|rate.*limit|429/i.test(combined)) return true;
  if (e.status === 502 || e.status === 503 || e.status === 504 || e.status === 529) return true;
  return false;
}

async function invokeAgent(agentId, input, opts){
  CrewFeed.log(agentId, 'working');
  const doCall = () => window.SB_Agents.invoke(agentId, input, opts || {});
  const MAX_RETRIES = 2;
  const BACKOFFS_MS = [1200, 2500];
  try {
    let r;
    let lastErr;
    for (let i = 0; i <= MAX_RETRIES; i++) {
      try { r = await doCall(); lastErr = null; break; }
      catch (err) {
        lastErr = err;
        if (i === MAX_RETRIES) break;
        if (!isTransientAgentError(err)) break;
        console.warn(`[invokeAgent] transient error on ${agentId} (attempt ${i+1}/${MAX_RETRIES+1}), retrying:`, err.message);
        CrewFeed.log(agentId, 'working');
        await new Promise(res => setTimeout(res, BACKOFFS_MS[i]));
      }
    }
    if (lastErr) throw lastErr;
    CrewFeed.log(agentId, 'done');
    return { ok: true, output: r.output ?? r.result ?? r.raw, raw: r.raw, credits: r.credits_charged ?? 0 };
  } catch (e) {
    const msg = humanizeError(e);
    CrewFeed.log(agentId, 'err', msg);
    return { ok: false, error: msg };
  }
}

// ── Context builder ─────────────────────────────────────────────────
// Every agent call should see the director's vision + the current bible
// + any upstream crew analysis outputs. This is "everything flows
// through the director" in code form — the cascade actually cascading.
//
// opts.lean = true:
//   Strips crew_analysis from the context. Use this for ad-hoc individual
//   agent invocations (tighten, polish-char, describe-loc, improve-shot)
//   where the full 12-agent crew history isn't needed. crew_analysis.story
//   alone can be 20-40KB after a full crew run; shipping that on every
//   one-off agent call was pushing specialist calls past the 18s timeout.
//   Crew runs (runPassive) still get the full context — downstream crew
//   agents DO benefit from reading upstream crew outputs.
function buildContext(p, extras, opts){
  opts = opts || {};
  const ctx = {};
  if (p.vision) ctx.vision = p.vision;
  if (p.genre_tags) ctx.genre_tags = p.genre_tags;
  if (p.character_bible && Object.keys(p.character_bible).length) ctx.character_bible = p.character_bible;
  if (p.location_library && Object.keys(p.location_library).length) ctx.location_library = p.location_library;
  if (!opts.lean && p.crew_analysis) ctx.crew_analysis = p.crew_analysis;
  if (p.shot_list && p.shot_list.length) ctx.shot_count = p.shot_list.length;
  if (extras) Object.assign(ctx, extras);
  return ctx;
}

// Passive = run in background, no UI spinner, update project on success,
// swallow errors (log only) so they never block the flow. Critical: if
// the agent call succeeded but returned no usable output (unparseable JSON,
// empty content, etc.), treat it as a soft failure — otherwise runCrew
// stores `undefined` in crew_analysis and downstream agents get polluted
// context.
//
// Auto-retries up to 2 times on transient backend errors (timeouts,
// 429/502/503/529). v81 added Sonnet→Haiku fallback at the SERVER level,
// but a stalled Anthropic pod can still cost the user a full 30s wait
// before falling through. By giving the CLIENT 2 fresh chances at hitting
// a healthy pod, we land most of the remaining ~5% of failed calls.
// Backoff is 1.5s then 3s (escalating) — gives Anthropic real time to
// recover instead of hammering a bad pod twice in quick succession.
async function runPassive(agentId, input, p, onOk){
  CrewFeed.log(agentId, 'working');
  const attempt = () => window.SB_Agents.invoke(agentId, input, { context: buildContext(p) });
  const MAX_RETRIES = 2;
  const BACKOFFS_MS = [1500, 3000];
  try {
    let r;
    let lastErr;
    for (let i = 0; i <= MAX_RETRIES; i++) {
      try { r = await attempt(); lastErr = null; break; }
      catch (err) {
        lastErr = err;
        if (i === MAX_RETRIES) break;
        if (!isTransientAgentError(err)) break;  // permanent error — stop
        console.warn(`[runPassive] transient error on ${agentId} (attempt ${i+1}/${MAX_RETRIES+1}), retrying:`, err.message);
        CrewFeed.log(agentId, 'working');
        await new Promise(res => setTimeout(res, BACKOFFS_MS[i]));
      }
    }
    if (lastErr) throw lastErr;
    const out = r.output ?? r.result ?? r.raw;
    if (out == null || (typeof out === 'object' && Object.keys(out).length === 0)) {
      CrewFeed.log(agentId, 'err', 'empty output');
      console.warn('passive ' + agentId + ' returned empty output');
      return { ok: false, reason: 'empty' };
    }
    CrewFeed.log(agentId, 'done');
    if (onOk) onOk(out);
    return { ok: true, output: out };
  } catch (e) {
    CrewFeed.log(agentId, 'err', humanizeError(e));
    console.warn('passive ' + agentId + ' failed (after retries):', e.message);
    return { ok: false, reason: e.code || 'error', error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// CREW ORCHESTRATOR — fires a group of agents with live UI progress +
// persists all outputs to p.crew_analysis[step] so downstream agents can
// read them via buildContext. Uses a concurrency throttle (2 at a time)
// to avoid Netlify function rate-limits and reduce Anthropic upstream
// pressure when running large crews (12+ agents).
// ═══════════════════════════════════════════════════════════════════════
async function runCrew(p, agentSpecs, step, targetEl, label){
  p.crew_analysis = p.crew_analysis || {};
  p.crew_analysis[step] = p.crew_analysis[step] || {};

  // Guard: if somehow targetEl is null (e.g. DOM not rendered yet), fail fast
  // with a user-visible message instead of crashing silently on innerHTML.
  if (!targetEl) {
    console.error('[runCrew] targetEl is null for step:', step);
    toast('UI not ready — try clicking again in a moment.', 'err');
    return;
  }

  const specs = agentSpecs.filter(s => s && s.id);
  targetEl.innerHTML = `
    <div class="crew-analysis">
      <div class="crew-head">
        <span class="crew-label">${esc(label)}</span>
        <span class="crew-counter" id="crew-counter-${step}">0 / ${specs.length}</span>
      </div>
      <div class="crew-grid">
        ${specs.map(s => `
          <div class="crew-row" data-crew-id="${esc(s.id)}">
            <span class="crew-dot">●</span>
            <span class="crew-name">${esc(s.label || s.id)}</span>
            <span class="crew-status">queued</span>
          </div>
        `).join('')}
      </div>
      <div class="crew-details" id="crew-details-${step}"></div>
    </div>
  `;

  let done = 0;
  const counter = document.getElementById('crew-counter-' + step);

  // Throttled concurrent execution — Netlify functions rate-limit hard when
  // too many fire at once, AND running too many in parallel against Anthropic
  // compounds latency when their pods are busy (each call competes for the
  // same upstream capacity, all timeouts trigger together). Dropped from 3 to
  // 2 in v79 after observing all 3 managers in a coverage crew time out
  // simultaneously when Anthropic was warm-but-loaded. Trade-off: a 6-agent
  // crew now takes ~45s instead of ~30s, but 95%+ reliability vs ~50%.
  const CONCURRENCY = 2;
  const queue = [...specs];
  const runners = [];

  async function worker() {
    while (queue.length > 0) {
      const spec = queue.shift();
      if (!spec) break;
      const row = targetEl.querySelector('[data-crew-id="' + CSS.escape(spec.id) + '"]');
      if (row) {
        row.querySelector('.crew-dot').style.color = '#B8922E';
        row.querySelector('.crew-status').textContent = 'working';
        row.classList.add('working');
      }
      const r = await runPassive(spec.id, spec.input, p);
      done++;
      if (counter) counter.textContent = `${done} / ${specs.length}`;
      if (r.ok) {
        p.crew_analysis[step][spec.id] = r.output;
        if (row) {
          row.querySelector('.crew-dot').style.color = '#2E6B3E';
          row.querySelector('.crew-status').textContent = 'complete';
          row.classList.remove('working');
          row.classList.add('ok');
        }
      } else if (row) {
        row.querySelector('.crew-dot').style.color = '#B03030';
        row.querySelector('.crew-status').textContent = 'failed';
        row.classList.remove('working');
        row.classList.add('err');
      }
    }
  }

  for (let i = 0; i < CONCURRENCY; i++) runners.push(worker());
  await Promise.all(runners);
  saveProject(p);

  // Render collapsed summary of successful outputs WITH apply panels so the
  // user can push agent suggestions straight into project state.
  const details = document.getElementById('crew-details-' + step);
  if (details) {
    const successful = specs.filter(s => p.crew_analysis[step][s.id]);
    if (successful.length === 0) {
      details.innerHTML = '<div class="crew-empty">No agents completed successfully. Try again or check usage.</div>';
    } else {
      // Build a data subset from p.crew_analysis[step] keyed by successful spec ids
      const successData = {};
      successful.forEach(s => { successData[s.id] = p.crew_analysis[step][s.id]; });
      // renderCrewResults renders the whole analysis container; we swap targetEl's
      // contents so it replaces the progress view with results+apply UI.
      targetEl.innerHTML = renderCrewResults(p, step, successData, (step.charAt(0).toUpperCase() + step.slice(1)) + ' crew results');
    }
  }

  const successCount = specs.filter(s => p.crew_analysis[step][s.id]).length;
  const kind = successCount === specs.length ? 'ok' : (successCount === 0 ? 'err' : 'ok');
  toast(`Crew: ${successCount}/${specs.length} complete.`, kind);
}

// ═══════════════════════════════════════════════════════════════════════
// CREW UI — renders a "Run Full Crew" card in each workflow step.
// Shows estimated credit cost on the button + confirms before spending.
// Non-owners see a confirm dialog; owners (bypass credits) run directly.
// ═══════════════════════════════════════════════════════════════════════
function renderFullCrewCard(p, step, title, description){
  const done = p?.crew_analysis?.[step] ? Object.keys(p.crew_analysis[step]).length : 0;
  const specs = getCrewSpecsFor(step, p);
  const totalCredits = specs.reduce((sum, s) => sum + (s.credits || 0), 0);
  const countLabel = specs.length;
  // Compute the missing agents (succeeded count < expected count) so we can
  // offer a "Retry failed only" button — costs less and finishes faster than
  // re-running the whole crew when only 1-2 agents timed out.
  const missingSpecs = specs.filter(s => !p?.crew_analysis?.[step]?.[s.id]);
  const hasPartial = done > 0 && missingSpecs.length > 0;
  const missingCredits = missingSpecs.reduce((sum, s) => sum + (s.credits || 0), 0);
  return `
    <div class="card" style="margin-top:14px;border-color:var(--gold);border-width:1px">
      <div style="display:flex;align-items:start;justify-content:space-between;gap:16px;flex-wrap:wrap">
        <div style="flex:1;min-width:250px">
          <h2 class="card-title" style="margin:0">✨ ${esc(title)}</h2>
          <p class="card-sub" style="margin-top:6px">${description.trim()}</p>
          <div style="margin-top:8px;font-size:11px;color:var(--text2)">
            <span class="badge">${countLabel} agents</span>
            <span class="badge" style="margin-left:4px">${totalCredits} credits</span>
            <span class="badge" style="margin-left:4px">Throttled 2 at a time · ~${Math.ceil(countLabel/2 * 15)}s</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
          ${hasPartial ? `<button class="btn btn-gold" data-crew-run-missing="${esc(step)}" data-crew-credits="${missingCredits}">Retry ${missingSpecs.length} failed (${missingCredits}c)</button>` : ''}
          <button class="btn ${hasPartial ? 'btn-ghost' : 'btn-gold'}" data-crew-run="${esc(step)}" data-crew-credits="${totalCredits}">${done > 0 ? 'Re-run full crew' : 'Run full crew'} (${totalCredits}c)</button>
          ${done > 0 ? `<span style="font-size:11px;color:var(--text2)">Last run: ${done} of ${countLabel} complete</span>` : ''}
        </div>
      </div>
      <div class="crew-target" id="crew-target-${esc(step)}" style="margin-top:12px">
        ${done > 0 ? renderCrewFromCache(p, step) : ''}
      </div>
    </div>
  `;
}

// When a crew has already run, re-render its cached outputs on next page load.
function renderCrewFromCache(p, step){
  const data = p?.crew_analysis?.[step];
  if (!data || !Object.keys(data).length) return '';
  return renderCrewResults(p, step, data, 'Last analysis');
}

// ═══════════════════════════════════════════════════════════════════════
// CREW RESULTS + APPLY PANEL
// Renders every completed agent's output with an "Apply" control that
// maps the output back onto project state via window.SB_Appliers.
// Used by BOTH the fresh-run path (runCrew) and the cached path
// (renderCrewFromCache) so the UI is consistent across reloads.
// ═══════════════════════════════════════════════════════════════════════
function renderCrewResults(p, step, data, headLabel){
  const entries = Object.entries(data).filter(([, out]) => out != null);
  const appliers = window.SB_Appliers;

  // Pre-compute previews so we can show counts up top and status per row.
  const previews = {};
  let totalChanges = 0;
  let agentsWithChanges = 0;
  entries.forEach(([id, out]) => {
    if (!appliers) { previews[id] = { count: 0, changes: [], no_changes: true, label: id }; return; }
    const pv = appliers.preview(id, out, p);
    previews[id] = pv;
    totalChanges += pv.count || 0;
    if ((pv.count || 0) > 0) agentsWithChanges++;
  });

  // Label lookup from the spec that produced this step (if available)
  const reg = (window.SB_Agents && window.SB_Agents.AGENTS_LOOKUP) || {};

  const applyAllBar = appliers && agentsWithChanges > 0 ? `
    <div class="crew-apply-all" data-crew-apply-all="${esc(step)}">
      <div class="crew-apply-all-text">
        <b>${totalChanges}</b> suggested change${totalChanges === 1 ? '' : 's'} across
        <b>${agentsWithChanges}</b> agent${agentsWithChanges === 1 ? '' : 's'}.
        Review each below, or apply everything at once.
      </div>
      <div class="crew-apply-all-actions">
        <button class="btn btn-gold btn-sm" data-crew-apply-step="${esc(step)}">Apply all (${totalChanges})</button>
        <button class="btn btn-ghost btn-sm" data-crew-expand-all="${esc(step)}">Expand all</button>
      </div>
    </div>
  ` : '';

  return `
    <div class="crew-analysis" data-crew-step="${esc(step)}">
      <div class="crew-head">
        <span class="crew-label">${esc(headLabel || 'Crew results')}</span>
        <span class="crew-counter">${entries.length} agent${entries.length === 1 ? '' : 's'} · ${totalChanges} change${totalChanges === 1 ? '' : 's'}</span>
      </div>
      ${applyAllBar}
      <div class="crew-details">
        ${entries.map(([id, out]) => renderAgentApplyCard(p, step, id, out, previews[id], reg[id])).join('')}
      </div>
    </div>
  `;
}

function renderAgentApplyCard(p, step, agentId, output, preview, registryEntry){
  const label = registryEntry?.name || preview?.label || agentId;
  const count = preview?.count || 0;
  const hasChanges = count > 0;

  const statusBadge = hasChanges
    ? `<span class="crew-apply-badge has-changes">${count} change${count === 1 ? '' : 's'}</span>`
    : `<span class="crew-apply-badge no-changes">✓ nothing to apply</span>`;

  const changesList = hasChanges ? preview.changes.map(c => `
    <label class="crew-change-row">
      <input type="checkbox" data-change-id="${esc(c.id)}" checked>
      <span class="crew-change-label">${esc(c.label)}</span>
      <span class="crew-change-kind">${esc(c.kind)}</span>
    </label>
  `).join('') : '';

  return `
    <details class="crew-output-detail crew-apply-detail${hasChanges ? ' has-changes' : ''}" data-crew-agent-card="${esc(agentId)}" data-crew-step="${esc(step)}">
      <summary>
        <span class="crew-apply-summary-name">${esc(label)}</span>
        ${statusBadge}
      </summary>
      <div class="crew-apply-body">
        ${hasChanges ? `
          <div class="crew-apply-list" data-change-list="${esc(agentId)}">
            ${changesList}
          </div>
          <div class="crew-apply-actions">
            <button class="btn btn-gold btn-sm" data-crew-apply-agent="${esc(agentId)}" data-crew-step-ref="${esc(step)}">Apply selected</button>
            <button class="btn btn-ghost btn-sm" data-crew-toggle-all="${esc(agentId)}">Select / deselect all</button>
            <button class="btn btn-ghost btn-sm" data-crew-show-raw="${esc(agentId)}">View raw output</button>
          </div>
        ` : `
          <div class="crew-apply-empty">
            This agent returned advisory output without concrete changes to apply. You can still view the raw output below.
            <div style="margin-top:8px"><button class="btn btn-ghost btn-sm" data-crew-show-raw="${esc(agentId)}">View raw output</button></div>
          </div>
        `}
        <pre class="crew-output-text" data-crew-raw="${esc(agentId)}" style="display:none">${esc(formatAgentOutput(output))}</pre>
      </div>
    </details>
  `;
}

// Apply handlers — delegated so they work for cached crews AND fresh runs.
// Installed once on document at boot; each handler walks the DOM to find
// the relevant project + step + agent context.
function installCrewApplyHandlers(){
  if (document._sbCrewApplyInstalled) return;
  document._sbCrewApplyInstalled = true;

  // Resolve the project associated with the crew card. We rely on the
  // current route, since each project has its own URL.
  function currentProjectFromRoute(){
    const r = parseRoute();
    const i = r.path.indexOf('project');
    if (i === -1) return null;
    const pid = r.path[i + 1];
    return getProject(pid);
  }

  document.addEventListener('click', async (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;

    // 1. Apply selected changes for a single agent
    const applyAgentBtn = t.closest('[data-crew-apply-agent]');
    if (applyAgentBtn) {
      e.preventDefault();
      const agentId = applyAgentBtn.dataset.crewApplyAgent;
      const step    = applyAgentBtn.dataset.crewStepRef;
      const project = currentProjectFromRoute();
      if (!project) { toast('Project not found', 'err'); return; }
      const out = project.crew_analysis?.[step]?.[agentId];
      if (!out) { toast('No output found for this agent', 'err'); return; }
      const listEl = document.querySelector(`[data-change-list="${CSS.escape(agentId)}"]`);
      const selected = listEl
        ? Array.from(listEl.querySelectorAll('input[data-change-id]:checked')).map(x => x.dataset.changeId)
        : null;
      const res = window.SB_Appliers.apply(agentId, out, project, selected || undefined);
      saveProject(project);
      if (res.errors && res.errors.length) {
        toast(`Applied ${res.applied}, ${res.errors.length} error${res.errors.length === 1 ? '' : 's'}`, 'err');
        console.error('[apply errors]', res.errors);
      } else if (res.applied === 0) {
        toast('Nothing selected to apply', 'err');
      } else {
        toast(`Applied ${res.applied} change${res.applied === 1 ? '' : 's'}`, 'ok');
      }
      // Re-render so the step picks up the newly-applied state
      render();
      return;
    }

    // 2. Apply ALL changes across the step's crew in one click
    const applyAllBtn = t.closest('[data-crew-apply-step]');
    if (applyAllBtn) {
      e.preventDefault();
      const step    = applyAllBtn.dataset.crewApplyStep;
      const project = currentProjectFromRoute();
      if (!project) { toast('Project not found', 'err'); return; }
      const crewData = project.crew_analysis?.[step];
      if (!crewData) { toast('No crew results for this step', 'err'); return; }
      if (!confirm(`Apply every suggested change from this crew run? You can still edit anything manually afterward.`)) return;
      const res = window.SB_Appliers.applyCrew(crewData, project);
      saveProject(project);
      if (res.errors && res.errors.length) {
        toast(`Applied ${res.applied}, ${res.errors.length} error${res.errors.length === 1 ? '' : 's'}`, 'err');
        console.error('[apply errors]', res.errors);
      } else {
        toast(`Applied ${res.applied} change${res.applied === 1 ? '' : 's'} across the crew`, 'ok');
      }
      render();
      return;
    }

    // 3. Expand all agent cards
    const expandBtn = t.closest('[data-crew-expand-all]');
    if (expandBtn) {
      e.preventDefault();
      const step = expandBtn.dataset.crewExpandAll;
      document.querySelectorAll(`[data-crew-step="${CSS.escape(step)}"] details.crew-apply-detail`)
        .forEach(d => { d.open = true; });
      return;
    }

    // 4. Toggle all checkboxes for an agent
    const toggleBtn = t.closest('[data-crew-toggle-all]');
    if (toggleBtn) {
      e.preventDefault();
      const agentId = toggleBtn.dataset.crewToggleAll;
      const listEl = document.querySelector(`[data-change-list="${CSS.escape(agentId)}"]`);
      if (!listEl) return;
      const boxes = Array.from(listEl.querySelectorAll('input[data-change-id]'));
      const anyUnchecked = boxes.some(b => !b.checked);
      boxes.forEach(b => { b.checked = anyUnchecked; });
      return;
    }

    // 5. Show raw output
    const rawBtn = t.closest('[data-crew-show-raw]');
    if (rawBtn) {
      e.preventDefault();
      const agentId = rawBtn.dataset.crewShowRaw;
      const pre = document.querySelector(`[data-crew-raw="${CSS.escape(agentId)}"]`);
      if (pre) pre.style.display = (pre.style.display === 'none' ? 'block' : 'none');
      return;
    }
  });
}

// Agent specs per workflow step. Each spec gets an id, label, credits, and a
// role-appropriate input built from the current project state.
function getCrewSpecsFor(step, p){
  // Pull credits from the registry so we track actual cost.
  const reg = (window.SB_Agents && window.SB_Agents.AGENTS_LOOKUP) || {};
  const credOf = (id) => (reg[id] && reg[id].credits) || 5;

  const n = p?.script?.normalized || {};
  const commonScriptInput = {
    title: n.title, scenes: n.scenes, character_list: n.character_list,
    vision: p?.vision, character_bible: p?.character_bible,
    location_library: p?.location_library,
  };
  switch (step) {
    case 'story': {
      const build = (instr) => JSON.stringify({...commonScriptInput, instruction: instr}, null, 2);
      return [
        { id: 'story-director',              label: 'Story Director',              credits: credOf('story-director'),              input: build('Declare structural verdict (sound/fixable/rewrite_needed), tag every scene with beat_type, flag cause_and_effect_gaps. Return full JSON schema.') },
        { id: 'beat-analyst',                label: 'Beat Analyst',                credits: credOf('beat-analyst'),                input: build('Tag every scene with beat_type and strength. Flag missing beats.') },
        { id: 'dialogue-writer',             label: 'Dialogue Writer',             credits: credOf('dialogue-writer'),             input: build('Audit dialogue across script. Return verdict, voice_distinctness_score, per_character_notes, top_rewrites.') },
        { id: 'dialogue-coach',              label: 'Dialogue Coach',              credits: credOf('dialogue-coach'),              input: build('Score voice distinctness per character, propose targeted rewrites for lines that fail.') },
        { id: 'cliche-detector',             label: 'Cliche Detector',             credits: credOf('cliche-detector'),             input: build('Flag on-the-nose, stock-phrase, and genre-cliche lines with severity calibration.') },
        { id: 'voice-consistency-auditor',   label: 'Voice Consistency Auditor',   credits: credOf('voice-consistency-auditor'),   input: build('Scan dialogue for lines that do not match each character voice signature. Return flags with rewrites.') },
        { id: 'action-writer',               label: 'Action Writer',               credits: credOf('action-writer'),               input: build('Audit action-line density per scene + formatting issues + subtext layer strength.') },
        { id: 'script-formatter',            label: 'Script Formatter',            credits: credOf('script-formatter'),            input: build('List industry-standard format issues (slug case, cue placement, paragraph length, transitions). Do not rewrite content.') },
        { id: 'subtext-writer',              label: 'Subtext Writer',              credits: credOf('subtext-writer'),              input: build('Layer subtext — name per-scene subtextual_intent, character_undertones, and action-line enrichments that carry meaning wordlessly.') },
        { id: 'psychological-builder',       label: 'Psychological Builder',       credits: credOf('psychological-builder'),       input: build('Build character psychology per named character — core_wound, external/internal desire, obstacle, arc_trajectory, moral_flaw.') },
        { id: 'voice-builder',               label: 'Voice Builder',               credits: credOf('voice-builder'),               input: build('Lock voice signatures across the 6 dimensions per character — vocabulary register, sentence length, contractions, patterns, never-says, regional markers.') },
        { id: 'adr-supervisor',              label: 'ADR Supervisor',              credits: credOf('adr-supervisor'),              input: build('Flag dialogue needing re-recording — background_noise, performance, model_limitation. Include production notes.') },
      ];
    }
    case 'cast': {
      const build = (instr) => JSON.stringify({...commonScriptInput, instruction: instr}, null, 2);
      return [
        { id: 'visual-character-builder',    label: 'Visual Character Builder',    credits: credOf('visual-character-builder'),    input: build('Build full character bible with canonical descriptions, consistency phrases, visual anchors per character.') },
        { id: 'psychological-builder',       label: 'Psychological Builder',       credits: credOf('psychological-builder'),       input: build('Build actionable psychology per character — core wound through arc trajectory.') },
        { id: 'emotion-mapper',              label: 'Emotion Mapper',              credits: credOf('emotion-mapper'),              input: build('Per-scene per-character emotional state + intensity + visible physical signs renderable by video model.') },
        { id: 'voice-builder',               label: 'Voice Builder',               credits: credOf('voice-builder'),               input: build('Lock voice signatures across 6 dimensions per character.') },
        { id: 'environment-builder',         label: 'Environment Builder',         credits: credOf('environment-builder'),         input: build('Build location library with scale, architecture style, era, materials, weathering, establishing prompts, sensory anchors.') },
        { id: 'architecture-designer',       label: 'Architecture Designer',       credits: credOf('architecture-designer'),       input: build('Per-location structural specs — building type, era, materials, scale, architectural signature.') },
      ];
    }
    case 'coverage': {
      const covInput = { ...commonScriptInput, shot_list: p?.shot_list };
      const build = (instr) => JSON.stringify({...covInput, instruction: instr}, null, 2);
      return [
        { id: 'visual-director',             label: 'Visual Director',             credits: credOf('visual-director'),             input: build('Lock visual grammar — dominant lens, framing principle, movement philosophy, composition rules, palette application.') },
        { id: 'atmospherics-builder',        label: 'Atmospherics Builder',        credits: credOf('atmospherics-builder'),        input: build('Layer per-scene atmospherics — time, weather, lighting plan, sound texture, sensory anchors.') },
        { id: 'weather-coordinator',         label: 'Weather Coordinator',         credits: credOf('weather-coordinator'),         input: build('Per-scene time-of-day, weather (with emotional intent), air quality, temperature feel with body-language notes.') },
        { id: 'dressing-builder',            label: 'Dressing Builder',            credits: credOf('dressing-builder'),            input: build('Coordinate per-location set dressing + per-scene hand props + VFX pipeline decisions.') },
        { id: 'props-master',                label: 'Props Master',                credits: credOf('props-master'),                input: build('Per-scene hero + signature + active props with significance hierarchy.') },
        { id: 'set-dresser',                 label: 'Set Dresser',                 credits: credOf('set-dresser'),                 input: build('Per-location wall/surface dressing + 3 worldbuilding hooks with density calibration per character association.') },
      ];
    }
    case 'generate': {
      const genInput = { ...commonScriptInput, shot_list: p?.shot_list };
      const build = (instr) => JSON.stringify({...genInput, instruction: instr}, null, 2);
      return [
        { id: 'prompt-writer',               label: 'Prompt Writer',               credits: credOf('prompt-writer'),               input: build('Set prompt strategy, model allocation across Kling/Veo/Hailuo/Seedance, global negative prompt, character reference policy (I2V vs T2V).') },
        { id: 'shot-calibrator',             label: 'Shot Calibrator',             credits: credOf('shot-calibrator'),             input: build('Per-shot per-model variants — Kling/Veo/Hailuo/Seedance tuned prompts with rationale.') },
        { id: 'vfx-supervisor',              label: 'VFX Supervisor',              credits: credOf('vfx-supervisor'),              input: build('Flag shots needing post-production VFX work — plate/composite/particle/cleanup/matte — with complexity + post-hour estimates.') },
      ];
    }
    case 'edit': {
      const editInput = { ...commonScriptInput, shot_list: p?.shot_list, timeline: p?.timeline };
      const build = (instr) => JSON.stringify({...editInput, instruction: instr}, null, 2);
      return [
        { id: 'timeline-editor',             label: 'Timeline Editor',             credits: credOf('timeline-editor'),             input: build('Lock cut structure (linear/rhythmic/disruptive/observational) + trim strategy. Identify match-cut / J-cut / L-cut placements.') },
        { id: 'pacing-editor',               label: 'Pacing Editor',               credits: credOf('pacing-editor'),               input: build('Match film heartbeat to Vision Director pacing contract. Plan breathing beats vs acceleration beats with rhythm diagnosis.') },
        { id: 'runtime-calculator',          label: 'Runtime Calculator',          credits: credOf('runtime-calculator'),          input: build('Estimate per-scene + total runtime with confidence scores. Compare to target, flag variance.') },
      ];
    }
    default:
      return [];
  }
}

// Wire the "Run full crew" button. Confirms with user before spending credits
// (owners bypass credit checks so confirm only shows cost as info).
function wireCrewButton(p, step){
  const btn = document.querySelector(`[data-crew-run="${CSS.escape(step)}"]`);
  if (btn) {
    btn.addEventListener('click', async () => {
      const specs = getCrewSpecsFor(step, p);
      if (!specs.length) { toast('No crew configured for this step.', 'err'); return; }
      const totalCredits = specs.reduce((sum, s) => sum + (s.credits || 0), 0);
      const isOwner = !!(window.SB_OWNER_TOKEN);
      const confirmMsg = isOwner
        ? `Run ${specs.length}-agent crew? (owner account — no credit charge)`
        : `Run ${specs.length} agents for ${totalCredits} credits? This fires the full crew for this step and can take 30–90 seconds.`;
      if (!confirm(confirmMsg)) return;
      btn.disabled = true;
      const stop = showSpinnerOn(btn);
      const targetEl = document.getElementById('crew-target-' + step);
      try {
        await runCrew(p, specs, step, targetEl, step.charAt(0).toUpperCase() + step.slice(1) + ' crew analysis');
      } finally {
        stop();
        btn.disabled = false;
        btn.textContent = `Re-run full crew (${totalCredits}c)`;
      }
    });
  }

  // Retry-only-the-failed-agents button. Filters to specs whose ID isn't
  // present in p.crew_analysis[step] yet, so a 6-agent crew where 3 timed
  // out only re-fires 3 agents costing the credits for those 3. Re-runs
  // the failed set through runCrew which preserves the existing successful
  // outputs (runCrew uses crew_analysis[step] = crew_analysis[step] || {}).
  const retryBtn = document.querySelector(`[data-crew-run-missing="${CSS.escape(step)}"]`);
  if (retryBtn) {
    retryBtn.addEventListener('click', async () => {
      const allSpecs = getCrewSpecsFor(step, p);
      const missingSpecs = allSpecs.filter(s => !p?.crew_analysis?.[step]?.[s.id]);
      if (!missingSpecs.length) { toast('Nothing to retry — all agents are complete.', 'err'); return; }
      const credits = missingSpecs.reduce((sum, s) => sum + (s.credits || 0), 0);
      const isOwner = !!(window.SB_OWNER_TOKEN);
      const names = missingSpecs.map(s => s.label || s.id).join(', ');
      const confirmMsg = isOwner
        ? `Retry ${missingSpecs.length} failed agent${missingSpecs.length === 1 ? '' : 's'}? (${names})`
        : `Retry ${missingSpecs.length} failed agent${missingSpecs.length === 1 ? '' : 's'} for ${credits} credits? (${names})`;
      if (!confirm(confirmMsg)) return;
      retryBtn.disabled = true;
      const stop = showSpinnerOn(retryBtn);
      const targetEl = document.getElementById('crew-target-' + step);
      try {
        await runCrew(p, missingSpecs, step, targetEl, `${step.charAt(0).toUpperCase() + step.slice(1)} crew — retrying ${missingSpecs.length}`);
      } finally {
        stop();
        retryBtn.disabled = false;
      }
    });
  }
}

function humanizeError(e){
  if (!e) return 'Something went wrong.';
  if (e.status === 401) return 'Please sign in again.';
  if (e.status === 402) return `Not enough credits. Need ${e.detail?.required ?? '?'}, have ${e.detail?.available ?? 0}.`;
  if (e.status === 403) return 'This feature needs a higher plan.';
  if (String(e.message || '').toLowerCase().includes('not logged in')) return 'Sign in before using assistants.';

  // 502: server reached the model provider but the provider errored out.
  // The REAL error message is in e.detail.detail (the nested server response).
  // Surface it so users and developers can actually diagnose.
  if (e.status === 502 && e.detail?.detail) {
    const d = String(e.detail.detail);
    // Common provider error signatures → friendlier summaries
    if (/invalid.*api.*key|authentication.*fail|x-api-key/i.test(d))
      return 'Anthropic API key invalid or missing. Check ANTHROPIC_API_KEY in Netlify env vars.';
    if (/model.*not.*found|unknown.*model|404/i.test(d))
      return 'Model not available to this API key. Check the model name in registry.js and that your key has access.';
    if (/rate.*limit|429/i.test(d))
      return 'Rate-limited by Anthropic. Wait a minute and try again.';
    if (/overloaded|529/i.test(d))
      return 'Anthropic servers are overloaded. Try again in a moment.';
    if (/max.tokens|context.*too.*long|too.*many.*tokens/i.test(d))
      return 'Input too long for the model context. Shorten the script or break into acts.';
    // Otherwise return the raw detail (truncated)
    return 'Model error: ' + d.slice(0, 240);
  }

  // 500: server couldn't reach the model provider or Firestore
  if (e.status === 500 && e.detail) {
    if (e.detail.error) return 'Server: ' + e.detail.error.slice(0, 200);
  }

  return e.message || 'Something went wrong.';
}

// ═══════════════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════════════
function boot(){
  // Keep rendering responsive to auth changes (firebase is async).
  // Also call bootstrap() on sign-in to ensure the Firestore user doc exists
  // before the user fires their first agent call.
  try {
    firebase.auth().onAuthStateChanged(user => {
      if (user) window.SB_Agents?.bootstrap();
      render();
    });
  } catch(e) { render(); }
  // Install delegated click handlers for crew Apply actions once.
  installCrewApplyHandlers();
}

// ═══════════════════════════════════════════════════════════════════════
//  RENDER (top-level)
// ═══════════════════════════════════════════════════════════════════════
function render(){
  const app = document.getElementById('app');

  if (!isSignedIn()) {
    app.innerHTML = renderGate();
    return;
  }

  const route = parseRoute();

  // /projects  (and default)
  if (!route.path[0] || route.path[0] === 'projects') {
    app.innerHTML = renderShell(null, renderProjects());
    wireProjectsHandlers();
    return;
  }

  // /project/new  → create + redirect
  if (route.path[0] === 'project' && route.path[1] === 'new') {
    const p = newProject();
    saveProject(p);
    go('project/' + p.id + '/vision');
    return;
  }

  // /project/:id/:step
  if (route.path[0] === 'project' && route.path[1]) {
    const p = getProject(route.path[1]);
    if (!p) { go('projects'); return; }
    const step = route.path[2] || 'vision';
    renderStep(app, p, step);
    return;
  }

  // Unknown route → projects
  go('projects');
}

// ── Gate (not signed in) ──────────────────────────────────────────────
function renderGate(){
  return `
    <div class="gate">
      <div class="gate-inner">
        <div class="gate-title">SHOTBREAK<span style="color:var(--gold)">.</span></div>
        <div class="gate-sub">Sign in to start a new project. Your existing SHOTBREAK account works here.</div>
        <a href="/app.html" class="btn btn-gold">Go to sign in →</a>
      </div>
    </div>
  `;
}

// ── Shell (rail + main) ───────────────────────────────────────────────
function renderShell(project, bodyHTML){
  const steps = [
    { key: 'vision',   label: 'Vision',      num: 1 },
    { key: 'story',    label: 'Story',       num: 2 },
    { key: 'cast',     label: 'Cast & Places', num: 3 },
    { key: 'coverage', label: 'Coverage',    num: 4 },
    { key: 'generate', label: 'Generate',    num: 5 },
    { key: 'edit',     label: 'Edit',        num: 6 },
    { key: 'deliver',  label: 'Deliver',     num: 7 },
  ];
  const route = parseRoute();
  const currentStep = route.path[2] || '';

  let stepsHTML = '<div class="empty" style="padding:20px">Select or start a project.</div>';
  if (project) {
    stepsHTML = steps.map(s => {
      const done = isStepComplete(project, s.key);
      const active = s.key === currentStep;
      const locked = !canReachStep(project, s.key);
      return `
        <button class="step ${active?'active':''} ${done?'done':''}" data-step="${s.key}" ${locked?'disabled':''}>
          <span class="num">${done ? '✓' : s.num}</span>
          <span>${s.label}</span>
          <span class="tick">${active ? 'NOW' : ''}</span>
        </button>
      `;
    }).join('');
  }

  const user = currentUserLabel();

  return `
    <div class="shell">
      <aside class="rail">
        <div class="rail-brand" onclick="location.hash='#/projects'">SHOTBREAK<span>.</span></div>
        ${project ? `
          <div class="rail-project">
            <div class="rail-project-label">Project</div>
            <div class="rail-project-name">${esc(project.title || 'Untitled')}</div>
          </div>
        ` : ''}
        <div class="rail-steps">${stepsHTML}</div>
        ${project ? `
          <div class="rail-crew">
            <div class="rail-crew-label">
              <span>Crew activity</span>
              <span class="rail-crew-count" id="rail-crew-count">0 / 50</span>
            </div>
            <div class="rail-crew-feed" id="rail-crew-feed">
              <div class="rail-crew-idle">Idle. Run an agent to see who's working.</div>
            </div>
          </div>
        ` : ''}
        <div class="rail-footer">
          <span>${esc(user)}</span>
          <a href="/app.html" title="Legacy interface">legacy ↗</a>
        </div>
      </aside>
      <main class="main">
        ${bodyHTML}
      </main>
    </div>
  `;
}

function isStepComplete(p, key){
  if (key === 'vision')   return !!(p.vision && p.vision.logline);
  if (key === 'story')    return !!(p.script && p.script.normalized && p.script.normalized.scenes.length);
  if (key === 'cast')     return Object.keys(p.character_bible || {}).length > 0;
  // Coverage soft gate: was previously "any shot at all unlocks".
  // New rule (v80): at least 50% of scenes have at least one shot. Avoids
  // the previous brittle behavior where 1 successful break unlocked the
  // rail forever even with 8 of 9 scenes still empty, AND avoids hard-
  // locking the user when 1-2 fade-out scenes legitimately can't be broken.
  if (key === 'coverage') {
    const scenes = p?.script?.normalized?.scenes || [];
    const shots  = p?.shot_list || [];
    if (!scenes.length || !shots.length) return false;
    const coveredSceneIds = new Set(shots.map(s => s.scene_id));
    const coveredCount = scenes.filter(s => coveredSceneIds.has(s.id)).length;
    return coveredCount >= Math.max(1, Math.ceil(scenes.length * 0.5));
  }
  if (key === 'generate') return Object.keys(p.clips || {}).length > 0;
  if (key === 'edit')     return !!(p.timeline && p.timeline.clips && p.timeline.clips.length);
  if (key === 'deliver')  return !!p.final_export_at;
  return false;
}
function canReachStep(p, key){
  const order = ['vision','story','cast','coverage','generate','edit','deliver'];
  const idx = order.indexOf(key);
  // Can reach any step up to one past the last completed step.
  for (let i = 0; i < idx; i++) {
    if (!isStepComplete(p, order[i])) return false;
  }
  return true;
}

// Wire step clicks in the rail
function wireRailSteps(project){
  document.querySelectorAll('.rail .step:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      go('project/' + project.id + '/' + btn.dataset.step);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  PROJECTS LIST
// ═══════════════════════════════════════════════════════════════════════
function renderProjects(){
  const all = loadProjects();
  const projects = Object.values(all).sort((a,b) => (b.updated_at || 0) - (a.updated_at || 0));

  const createCard = `
    <div class="create-card" id="create-card">
      <div class="create-head">
        <div class="create-kicker">· New project ·</div>
        <h2 class="create-title">Start a film.</h2>
        <p class="create-sub">Name it. Drop your script (any length — up to ~500 pages) or paste a snippet. Or leave it empty and the Vision step will gather it.</p>
      </div>
      <div class="create-body">
        <label class="create-label" for="np-title">Project name</label>
        <input type="text" id="np-title" class="create-input" placeholder="The Detective's Curse" autocomplete="off" />

        <label class="create-label" style="margin-top:18px">Script <span class="create-opt">(optional)</span></label>

        <div class="script-intake">
          <div class="script-intake-mode-tabs" role="tablist">
            <button type="button" class="intake-tab active" data-mode="upload" role="tab">📄 Upload file</button>
            <button type="button" class="intake-tab" data-mode="paste" role="tab">⌨ Paste text</button>
          </div>

          <div class="intake-pane active" data-pane="upload">
            <div class="upload-zone" id="np-drop" tabindex="0" role="button" aria-label="Upload script file">
              <div class="upload-zone-icon">📄</div>
              <div class="upload-zone-title">Drop your script here</div>
              <div class="upload-zone-sub">or <span class="accent">click to browse</span> · <code>.pdf</code> <code>.docx</code> <code>.fdx</code> <code>.fountain</code> <code>.txt</code></div>
            </div>
            <input type="file" id="np-file" accept=".txt,.fountain,.fdx,.docx,.pdf" style="display:none" />
            <div id="np-upload-status" style="display:none"></div>
            <div id="np-loaded" style="display:none"></div>
          </div>

          <div class="intake-pane" data-pane="paste">
            <textarea id="np-script" class="create-textarea" placeholder="INT. DETECTIVE OFFICE — NIGHT

Rain streaks the window. MAYA CHEN (40s, sharp, exhausted) stands over a desk buried in case files. She doesn't look up when the door opens.

                MAYA
    You're three hours late.

                DANE
                  (breathless)
    I found him." rows="10"></textarea>
          </div>
        </div>

        <div class="create-actions">
          <button class="btn btn-gold btn-create" id="np-create">Create project →</button>
          <span class="create-hint">The Vision Director will read this first.</span>
        </div>
      </div>
    </div>
  `;

  const existing = projects.length === 0 ? '' : `
    <div class="projects-section-head">
      <h3 class="projects-section-title">Your projects</h3>
      <span class="projects-section-meta">${projects.length} total</span>
    </div>
    <div class="projects-grid">
      ${projects.map(p => `
        <div class="proj-card-wrap" style="position:relative">
          <a href="#/project/${p.id}/${stepFor(p)}" class="proj-card" data-id="${p.id}">
            <div class="proj-title">${esc(p.title || 'Untitled project')}</div>
            <div class="proj-sub">${esc(truncate(p.vision?.logline || 'No vision yet.', 120))}</div>
            <div class="proj-foot">
              <span>${stepLabel(stepFor(p))}</span>
              <span>${relativeDate(p.updated_at)}</span>
            </div>
          </a>
          <button class="proj-delete" data-delete-project="${p.id}" title="Delete this project permanently" aria-label="Delete project">×</button>
        </div>
      `).join('')}
    </div>
  `;

  return `
    <div class="main-header">
      <div class="main-title">Your studio</div>
      <div class="main-meta">${projects.length} project${projects.length === 1 ? '' : 's'}</div>
    </div>
    <div class="main-body">
      <div class="main-body-inner">
        <h1 class="hero-title">Welcome back${window.SB_OWNER_NAME ? ', ' + capitalize(window.SB_OWNER_NAME) : ''}.</h1>
        <p class="hero-sub">Fifty expert-craft AI agents. Five production wings. One finished film.</p>
        ${createCard}
        ${existing}
      </div>
    </div>
  `;
}

function stepFor(p){
  // Resume at the first unfinished step
  const order = ['vision','story','cast','coverage','generate','edit','deliver'];
  for (const k of order) if (!isStepComplete(p, k)) return k;
  return 'deliver';
}
function stepLabel(k){
  return ({vision:'Vision',story:'Story',cast:'Cast & Places',coverage:'Coverage',generate:'Generate',edit:'Edit',deliver:'Deliver'})[k] || k;
}

function wireProjectsHandlers(){
  // Wire per-project delete buttons (the × in top-right of each card)
  document.querySelectorAll('[data-delete-project]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.deleteProject;
      const all = loadProjects();
      const proj = all[id];
      if (!proj) return;
      if (!confirm(`Delete "${proj.title || 'Untitled project'}"? This cannot be undone.`)) return;
      deleteProject(id);
      toast('Project deleted', 'ok');
      render();
    });
  });

  // Prewarm button — fires one small Vision Director call to warm the
  // Netlify function cold start + verify Anthropic connection. Run this
  // 5 minutes before any demo to eliminate the first-request lag.
  document.getElementById('btn-prewarm')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const link = e.currentTarget;
    const original = link.textContent;
    link.textContent = '🔥 Warming…';
    link.style.pointerEvents = 'none';
    const started = Date.now();
    try {
      const r = await window.SB_Agents.invoke('auteur',
        'ping: warmup test. Return a minimal vision JSON.',
        { context: {} }
      );
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      if (r && r.ok !== false) {
        link.textContent = `✓ Warm (${elapsed}s)`;
        toast(`Agents warmed in ${elapsed}s. Ready for demo.`, 'ok');
      } else {
        link.textContent = `⚠ ${elapsed}s`;
        toast(`Prewarm responded but result unclear. Check console.`, 'err');
      }
    } catch (err) {
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      link.textContent = `✗ Failed`;
      toast(`Prewarm failed after ${elapsed}s: ${err.message}`, 'err');
      console.error('Prewarm:', err);
    }
    setTimeout(() => {
      link.textContent = original;
      link.style.pointerEvents = '';
    }, 8000);
  });

  const createBtn = document.getElementById('np-create');
  const titleEl   = document.getElementById('np-title');
  const scriptEl  = document.getElementById('np-script');
  if (!createBtn) return;

  // Where the parsed script ends up (either from upload or paste)
  // We use scriptEl.value as the source of truth in all cases.
  let loadedFileMeta = null; // { name, size, lines, scenes }

  // Focus the title field on mount for immediate typing
  if (titleEl && !titleEl.value) setTimeout(() => titleEl.focus(), 100);

  // Enter in title → move focus to upload area
  titleEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('np-drop')?.focus(); }
  });

  // ── Tab switching (Upload ↔ Paste) ─────────────────────────
  document.querySelectorAll('.intake-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const mode = tab.dataset.mode;
      document.querySelectorAll('.intake-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.intake-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === mode));
    });
  });

  // ── Upload zone: click to browse + drag-drop ───────────────
  const dropZone   = document.getElementById('np-drop');
  const fileInput  = document.getElementById('np-file');
  const statusEl   = document.getElementById('np-upload-status');
  const loadedEl   = document.getElementById('np-loaded');

  if (dropZone && fileInput) {
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });
    ['dragenter', 'dragover'].forEach(evt => {
      dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    });
    ['dragleave', 'dragend', 'drop'].forEach(evt => {
      dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); });
    });
    dropZone.addEventListener('drop', (e) => {
      const f = e.dataTransfer?.files?.[0];
      if (f) handleFile(f);
    });
    fileInput.addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      if (f) handleFile(f);
    });
  }

  async function handleFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const supported = ['txt', 'fountain', 'fdx', 'docx', 'pdf'];
    if (!supported.includes(ext)) {
      showStatus('Unsupported format: .' + ext + '. Use .pdf, .docx, .fdx, .fountain, or .txt.', true);
      return;
    }
    // Soft size limit: warn above 10MB
    if (file.size > 10 * 1024 * 1024) {
      showStatus('File is ' + (file.size / 1024 / 1024).toFixed(1) + ' MB — extraction may take a minute.', false);
    } else {
      showStatus('<span class="upload-spinner"></span> Extracting script from ' + esc(file.name) + '...', false);
    }

    let text = '';
    try {
      if (ext === 'txt' || ext === 'fountain')   text = await file.text();
      else if (ext === 'docx')                    text = await readDocx(file);
      else if (ext === 'fdx')                     text = await readFdx(file);
      else if (ext === 'pdf')                     text = await readPdf(file);
    } catch (e) {
      console.error('[intake] parse failed:', e);
      showStatus('Could not read ' + esc(file.name) + ': ' + esc(e.message || 'unknown error'), true);
      return;
    }

    if (!text || !text.trim()) {
      showStatus('File looks empty — no text extracted.', true);
      return;
    }

    // Stash extracted text into the paste textarea (source of truth)
    scriptEl.value = text;

    // Compute quick stats
    const lines  = text.split('\n').length;
    const scenes = (text.match(/^\s*(INT\.|EXT\.|INT\/EXT|EXT\/INT|I\/E\.)/gmi) || []).length;
    const chars  = text.length;

    loadedFileMeta = { name: file.name, size: file.size, lines, scenes, chars };

    // Hide the drop zone, show the "loaded" pill
    dropZone.style.display = 'none';
    statusEl.style.display = 'none';
    loadedEl.style.display = 'block';
    loadedEl.innerHTML = `
      <div class="upload-loaded">
        <div class="upload-loaded-icon">✓</div>
        <div class="upload-loaded-info">
          <div class="upload-loaded-name">${esc(file.name)}</div>
          <div class="upload-loaded-stats">${lines.toLocaleString()} lines · ${scenes} scene${scenes===1?'':'s'} detected · ${(file.size/1024).toFixed(1)} KB</div>
        </div>
        <div class="upload-loaded-actions">
          <button type="button" class="upload-loaded-btn" id="np-loaded-view">View</button>
          <button type="button" class="upload-loaded-btn remove" id="np-loaded-remove">Remove</button>
        </div>
      </div>
    `;
    document.getElementById('np-loaded-view')?.addEventListener('click', () => {
      // Switch to paste tab so user can inspect/edit
      document.querySelector('.intake-tab[data-mode="paste"]')?.click();
      scriptEl.focus();
    });
    document.getElementById('np-loaded-remove')?.addEventListener('click', () => {
      scriptEl.value = '';
      loadedFileMeta = null;
      loadedEl.style.display = 'none';
      dropZone.style.display = 'flex';
      fileInput.value = '';
    });

    toast('Loaded ' + file.name + ' · ' + lines.toLocaleString() + ' lines', 'ok');
  }

  function showStatus(html, isErr) {
    if (!statusEl) return;
    statusEl.className = 'upload-status' + (isErr ? ' err' : '');
    statusEl.innerHTML = html;
    statusEl.style.display = 'flex';
  }

  // ── File parsers ──────────────────────────────────────────
  async function readDocx(file) {
    if (typeof window.JSZip === 'undefined') throw new Error('DOCX reader not loaded');
    const ab = await file.arrayBuffer();
    const zip = await window.JSZip.loadAsync(ab);
    const xmlFile = zip.file('word/document.xml');
    if (!xmlFile) throw new Error('DOCX missing document.xml');
    const xml = await xmlFile.async('string');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const paras = doc.getElementsByTagNameNS(ns, 'p');
    const lines = [];
    for (let i = 0; i < paras.length; i++) {
      const ts = paras[i].getElementsByTagNameNS(ns, 't');
      let line = '';
      for (let j = 0; j < ts.length; j++) line += ts[j].textContent;
      lines.push(line);
    }
    return lines.join('\n');
  }

  async function readFdx(file) {
    const text = await file.text();
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const paras = doc.getElementsByTagName('Paragraph');
    const out = [];
    const kept = new Set(['Scene Heading', 'Action', 'Character', 'Dialogue', 'Parenthetical', 'Transition']);
    for (let i = 0; i < paras.length; i++) {
      const type = paras[i].getAttribute('Type') || '';
      if (!kept.has(type)) continue;
      const ts = paras[i].getElementsByTagName('Text');
      let content = '';
      for (let j = 0; j < ts.length; j++) content += ts[j].textContent;
      // Indent character / dialogue / parenthetical for screenplay look
      if (type === 'Character')      out.push('                ' + content);
      else if (type === 'Parenthetical') out.push('                  ' + content);
      else if (type === 'Dialogue')     out.push('    ' + content);
      else                              out.push(content);
      if (type === 'Scene Heading' || type === 'Transition') out.push('');
    }
    return out.join('\n');
  }

  async function readPdf(file) {
    if (typeof window.pdfjsLib === 'undefined') throw new Error('PDF reader not loaded');
    const ab = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: ab }).promise;
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      // Reconstruct lines from positioned text items
      let lines = [];
      let currentLine = '';
      let lastY = null;
      for (const item of content.items) {
        const y = Math.round(item.transform[5]);
        if (lastY !== null && Math.abs(y - lastY) > 2) {
          lines.push(currentLine); currentLine = '';
        }
        currentLine += item.str;
        if (item.hasEOL) { lines.push(currentLine); currentLine = ''; }
        lastY = y;
      }
      if (currentLine) lines.push(currentLine);
      pages.push(lines.join('\n'));
      // Progress update
      if (p % 10 === 0 || p === pdf.numPages) {
        showStatus('<span class="upload-spinner"></span> Extracting PDF... page ' + p + ' / ' + pdf.numPages, false);
      }
    }
    return pages.join('\n\n');
  }

  // ── Create button ─────────────────────────────────────────
  createBtn.addEventListener('click', () => {
    const title = (titleEl?.value || '').trim();
    const rawScript = (scriptEl?.value || '').trim();
    if (!title) {
      titleEl?.focus();
      titleEl?.classList.add('create-input-err');
      setTimeout(() => titleEl.classList.remove('create-input-err'), 2000);
      toast('Name your project first.', 'err');
      return;
    }

    const p = newProject();
    p.title = title;
    if (rawScript) {
      p.script.raw = rawScript;
      if (loadedFileMeta) p.script.source_filename = loadedFileMeta.name;
      try {
        if (window.SB_Normalize?.normalizeScript) {
          p.script.normalized = window.SB_Normalize.normalizeScript(rawScript);
        }
      } catch (e) { /* story step will normalize */ }
    }
    saveProject(p);
    toast('Project created.', 'ok');
    go('project/' + p.id + '/vision');
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  STEP DISPATCHER
// ═══════════════════════════════════════════════════════════════════════
function renderStep(app, project, step){
  const renderer = ({
    vision:   renderVisionStep,
    story:    renderStoryStep,
    cast:     renderCastStep,
    coverage: renderCoverageStep,
    generate: renderGenerateStep,
    edit:     renderEditStep,
    deliver:  renderDeliverStep,
  })[step];
  if (!renderer) { go('project/' + project.id + '/vision'); return; }
  const body = renderer(project);
  app.innerHTML = renderShell(project, body);
  wireRailSteps(project);
  // Step-specific wiring
  const wirer = ({
    vision:   wireVisionStep,
    story:    wireStoryStep,
    cast:     wireCastStep,
    coverage: wireCoverageStep,
    generate: wireGenerateStep,
    edit:     wireEditStep,
    deliver:  wireDeliverStep,
  })[step];
  if (wirer) wirer(project);
}

// ═══════════════════════════════════════════════════════════════════════
//  STEP 1 — VISION LOCK
// ═══════════════════════════════════════════════════════════════════════
function renderVisionStep(p){
  const v = p.vision;
  return `
    <div class="main-header">
      <div class="main-title">① Vision</div>
      <div class="main-meta">Step <b>1</b> of 7</div>
    </div>
    <div class="main-body">
      <div class="main-body-inner">
        <h1 class="hero-title">Lock in what this film is.</h1>
        <p class="hero-sub">Four questions. Every assistant downstream reads this, so it stops anyone from silently disagreeing about what you're making.</p>

        <div class="card">
          <label for="f-title">Project title</label>
          <input type="text" id="f-title" value="${esc(p.title === 'Untitled project' ? '' : p.title)}" placeholder="The Detective's Curse">

          <label for="f-logline">Logline — one sentence</label>
          <textarea id="f-logline" placeholder="A cursed detective pursues a killer through rain-soaked LA, only to find the killer is herself.">${esc(v?.logline || '')}</textarea>

          <div class="row">
            <div>
              <label for="f-length">Length (seconds)</label>
              <input type="number" id="f-length" value="${v?.length_seconds || 180}" min="15" max="3600">
            </div>
            <div>
              <label for="f-genre">Genre</label>
              <select id="f-genre">
                ${['neo-noir','noir','thriller','horror','sci-fi','fantasy','drama','romance','comedy','action','western','documentary'].map(g =>
                  `<option value="${g}" ${v?.genre === g ? 'selected' : ''}>${capitalize(g)}</option>`
                ).join('')}
              </select>
            </div>
          </div>

          <div class="row">
            <div>
              <label for="f-refs">Reference films <span style="text-transform:none;color:var(--dim);font-weight:400">(comma separated, optional)</span></label>
              <input type="text" id="f-refs" value="${esc((v?.references || []).join(', '))}" placeholder="Blade Runner 2049, Chinatown">
            </div>
            <div>
              <label for="f-ratio">Aspect ratio</label>
              <select id="f-ratio">
                <option value="16:9" ${v?.aspect_ratio === '16:9' ? 'selected' : ''}>16:9 (cinematic)</option>
                <option value="9:16" ${v?.aspect_ratio === '9:16' ? 'selected' : ''}>9:16 (phone/vertical)</option>
                <option value="1:1"  ${v?.aspect_ratio === '1:1'  ? 'selected' : ''}>1:1 (square)</option>
              </select>
            </div>
          </div>

          <div class="btn-row">
            <button class="btn btn-gold" id="btn-lock-vision">Lock the vision</button>
            ${v ? '<button class="btn btn-ghost" id="btn-skip-vision">Keep and continue →</button>' : ''}
            <span id="vision-status" style="font-size:12px;color:var(--text2);margin-left:auto"></span>
          </div>
        </div>

        ${v ? renderVisionDoc(v) : ''}
      </div>
    </div>
  `;
}

function renderVisionDoc(v){
  const pal = v.palette || {};
  const swatches = [pal.primary, pal.secondary, pal.accent].filter(Boolean);
  return `
    <div class="vision-doc" style="margin-top:14px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
        <div class="badge badge-gold">Your film's vision</div>
        <div class="badge">auto-drafted</div>
      </div>
      <p class="vision-quote">“${esc(v.logline)}”</p>
      <div class="vision-grid">
        ${v.tonal_anchors ? `<div><div class="vision-item-label">Tonal anchors</div><div class="vision-item-value">${(v.tonal_anchors || []).map(esc).join(' · ')}</div></div>` : ''}
        ${v.lens_language ? `<div><div class="vision-item-label">Lens language</div><div class="vision-item-value">${esc(v.lens_language)}</div></div>` : ''}
        ${v.pacing_contract ? `<div><div class="vision-item-label">Pacing</div><div class="vision-item-value">${esc(v.pacing_contract)}</div></div>` : ''}
        ${swatches.length ? `<div>
          <div class="vision-item-label">Palette</div>
          <div class="vision-palette">${swatches.map(h => `<div class="vision-swatch" style="background:${esc(h)}" title="${esc(h)}"></div>`).join('')}</div>
        </div>` : ''}
      </div>
    </div>
  `;
}

function wireVisionStep(p){
  document.getElementById('btn-lock-vision')?.addEventListener('click', async () => {
    const title = document.getElementById('f-title').value.trim();
    const logline = document.getElementById('f-logline').value.trim();
    const length = parseInt(document.getElementById('f-length').value, 10) || 180;
    const genre = document.getElementById('f-genre').value;
    const refs = document.getElementById('f-refs').value.split(',').map(s => s.trim()).filter(Boolean);
    const ratio = document.getElementById('f-ratio').value;

    if (!logline || logline.length < 10) { toast('Give me a one-sentence logline first.', 'err'); return; }

    p.title = title || (logline.split(/[.,;]/)[0].slice(0, 60));
    saveProject(p);

    const stop = showSpinnerOn(document.getElementById('btn-lock-vision'));
    document.getElementById('vision-status').textContent = 'Your director is drafting the vision...';

    // Build brief for AUTEUR using the standardizer
    const brief = {
      premise: logline,
      length_seconds: length,
      genre,
      references: refs,
      aspect_ratio: ratio,
      tone_hint: 'user-supplied logline captures intended tone',
    };
    const r = await invokeAgent('auteur', JSON.stringify(brief, null, 2));

    stop();
    document.getElementById('vision-status').textContent = '';

    if (!r.ok) { toast(r.error, 'err'); return; }

    // AUTEUR (Vision Director) returns structured JSON. Persist every field
    // from the upgraded schema so downstream agents inherit full context.
    const out = r.output || {};
    p.vision = {
      // User-supplied inputs
      logline:          out.logline         || logline,     // Vision Director may sharpen the logline
      length_seconds:   length,
      genre,
      references:       refs,
      aspect_ratio:     ratio,
      // From Vision Director's upgraded schema:
      vision_statement:     out.vision_statement     || logline,
      tonal_anchors:        out.tonal_anchors        || [],
      lens_language:        out.lens_language        || '',
      pacing_contract:      out.pacing_contract      || '',
      palette:              out.palette              || {},
      continuity_rules:     out.continuity_rules     || [],
      genre_interpretation: out.genre_interpretation || '',
      reference_synthesis:  out.reference_synthesis  || '',
      // Primary field name from upgraded agent. Keep legacy field for backward compat.
      handoff_to_downstream: out.handoff_to_downstream || out.handoff_to_showrunner || '',
      handoff_to_showrunner: out.handoff_to_showrunner || out.handoff_to_downstream || '',
    };
    saveProject(p);
    toast('Vision locked.', 'ok');
    render();

    // Passive enrichment — Genre Specialist + Color Theorist run silently
    // in the background. These don't cost the user a button click; they
    // fill in genre conventions and palette refinements so every downstream
    // specialist inherits a richer vision.
    document.getElementById('vision-status') && (document.getElementById('vision-status').textContent = 'Genre & palette analysis...');
    // Both callbacks merge into the *current* project on disk rather than the
    // closure-captured `p`. Otherwise any edits the user makes between locking
    // vision and these background calls returning (typically 30-90s) get
    // silently clobbered when we save the stale snapshot.
    runPassive('genre-specialist',
      JSON.stringify({ vision: p.vision, instruction: 'List 5-8 genre conventions for ' + genre + ' to honor in this project. Return {conventions: [string], visual_motifs: [string], avoid: [string]}.' }, null, 2),
      p,
      (out) => {
        const latest = getProject(p.id) || p;
        latest.genre_tags = out;
        saveProject(latest);
      }
    ).then(() => runPassive('color-theorist',
      JSON.stringify({ vision: p.vision, instruction: 'Refine the palette. Return {primary, secondary, accent, rationale} as hex colors and a one-line rationale tied to the genre.' }, null, 2),
      p,
      (out) => {
        if (out.primary || out.secondary || out.accent) {
          const latest = getProject(p.id) || p;
          latest.vision = latest.vision || {};
          latest.vision.palette = { primary: out.primary, secondary: out.secondary, accent: out.accent, rationale: out.rationale };
          saveProject(latest);
          render();
        }
      }
    )).finally(() => {
      const el = document.getElementById('vision-status');
      if (el) el.textContent = '';
    });
  });

  document.getElementById('btn-skip-vision')?.addEventListener('click', () => {
    go('project/' + p.id + '/story');
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  STEP 2 — STORY
// ═══════════════════════════════════════════════════════════════════════
function renderStoryStep(p){
  const n = p.script.normalized;
  const hasScript = !!(n && n.scenes && n.scenes.length);

  return `
    <div class="main-header">
      <div class="main-title">② Story</div>
      <div class="main-meta">Step <b>2</b> of 7</div>
    </div>
    <div class="main-body">
      <div class="main-body-inner">
        <h1 class="hero-title">Drop in your script. We'll clean it up.</h1>
        <p class="hero-sub">Paste a screenplay, a Fountain file, or just a prose scene. We strip title pages, revision marks, and formatting junk before any assistant touches it.</p>

        <div class="card">
          <label for="script-in">Your script or scene</label>
          <textarea class="script-paste" id="script-in" placeholder="INT. DETECTIVE'S OFFICE - NIGHT&#10;&#10;Rain streaks the window. MAYA, 30s, stares at a case file.&#10;&#10;MAYA&#10;Another one.&#10;&#10;...or paste prose. We handle both.">${esc(p.script.raw || '')}</textarea>
          <div class="btn-row">
            <button class="btn btn-gold" id="btn-normalize">${hasScript ? 'Re-parse script' : 'Parse script'}</button>
            ${hasScript ? '<button class="btn btn-ghost" id="btn-continue-cast">Continue to Cast & Places →</button>' : ''}
            <span id="norm-status" style="font-size:12px;color:var(--text2);margin-left:auto"></span>
          </div>
        </div>

        ${hasScript ? renderParsedSummary(n) : ''}
        ${hasScript ? renderFullCrewCard(p, 'story', 'Run full writers + characters crew', `
          12 specialists analyze voice, structure, dialogue, cliches, subtext, character psychology, and ADR needs.
          Runs Story Director, Beat Analyst, Dialogue Writer + Coach, Cliche Detector, Voice Consistency Auditor,
          Action Writer, Script Formatter, Subtext Writer, Psychological Builder, Voice Builder, and ADR Supervisor in parallel.
        `) : ''}
        ${hasScript ? renderScenesList(p) : ''}
      </div>
    </div>
  `;
}

function renderParsedSummary(n){
  return `
    <div class="card" style="margin-top:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div>
          <div class="card-title" style="margin:0">${esc(n.title)}</div>
          <div style="color:var(--text2);font-size:12px;margin-top:4px">
            <span class="badge">${esc(n.format_detected)}</span>
            <span class="badge">${n.scene_count} scene${n.scene_count === 1 ? '' : 's'}</span>
            <span class="badge">${(n.character_list || []).length} character${(n.character_list || []).length === 1 ? '' : 's'}</span>
          </div>
        </div>
        <div style="font-size:11px;color:var(--text2);max-width:60%;text-align:right">
          ${(n.character_list || []).slice(0, 6).map(c => esc(c.name)).join(' · ')}
        </div>
      </div>
    </div>
  `;
}

function renderScenesList(p){
  const n = p.script.normalized;
  return `
    <div style="margin-top:18px">
      ${n.scenes.map((s, i) => `
        <div class="scene" data-scene-id="${s.id}">
          <div class="scene-head">
            <span class="tag">${esc(s.id)}</span>
            <span>${esc(s.slug)}</span>
            ${s.characters_present.length ? `<span class="tag" style="margin-left:auto">${s.characters_present.map(esc).join(', ')}</span>` : ''}
          </div>
          <div class="scene-body">${renderSceneBodyDisplay(s)}</div>
          <div class="scene-actions">
            <button class="btn btn-ghost btn-sm" data-action="tighten" data-scene-id="${s.id}">✨ Tighten this scene</button>
          </div>
          <div class="scene-suggest" id="sug-${s.id}"></div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderSceneBodyDisplay(scene){
  let html = '';
  if (scene.action) html += '<b>' + esc(scene.action.slice(0, 500)) + (scene.action.length > 500 ? '...' : '') + '</b>\n\n';
  scene.dialogue.forEach(d => {
    html += esc(d.character) + (d.parenthetical ? ' <i>(' + esc(d.parenthetical) + ')</i>' : '') + '\n' + esc(d.line) + '\n\n';
  });
  return html;
}

function wireStoryStep(p){
  wireCrewButton(p, 'story');
  document.getElementById('btn-normalize')?.addEventListener('click', () => {
    const raw = document.getElementById('script-in').value;
    if (!raw.trim()) { toast('Paste a script first.', 'err'); return; }
    document.getElementById('norm-status').textContent = 'Cleaning up...';
    const normalized = window.SB_Normalize.normalizeScript(raw);
    p.script.raw = raw;
    p.script.normalized = normalized;
    saveProject(p);
    document.getElementById('norm-status').textContent = '';
    toast(`Parsed ${normalized.scene_count} scene${normalized.scene_count === 1 ? '' : 's'}`, 'ok');
    render();
  });

  document.getElementById('btn-continue-cast')?.addEventListener('click', () => {
    seedCastFromScript(p, /*force*/ false);
    saveProject(p);
    go('project/' + p.id + '/cast');
  });

  // Scene-level actions
  document.querySelectorAll('[data-action="tighten"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const sceneId = btn.dataset.sceneId;
      const scene = p.script.normalized.scenes.find(s => s.id === sceneId);
      if (!scene) return;
      const stop = showSpinnerOn(btn);

      // Build input with the full director's vision as context
      const input = {
        scene_id: scene.id,
        slug: scene.slug,
        raw_scene: scene.raw,
        instruction: 'Tighten this scene. Keep it the same length or shorter. Keep the voice. Return only the revised scene as plain screenwriting format.',
      };
      const r = await invokeAgent('script-doctor', JSON.stringify(input, null, 2), { context: buildContext(p, null, {lean: true}) });
      stop();

      const sugEl = document.getElementById('sug-' + sceneId);
      if (!r.ok) {
        sugEl.innerHTML = `<div class="suggest" style="border-color:var(--red-border);background:var(--red-bg)"><div class="suggest-body">${esc(r.error)}</div></div>`;
        return;
      }

      // Script Doctor's upgraded schema returns `revised_raw` (the full revised scene
      // in screenplay format). Fall back to legacy keys for compatibility, then to
      // the original text if we genuinely got nothing usable (never the JSON blob).
      let suggestion;
      let changesSummary = '';
      let cutPct = null;
      if (typeof r.output === 'string') {
        suggestion = r.output;
      } else if (r.output && typeof r.output === 'object') {
        suggestion = r.output.revised_raw
                  || r.output.revised_scene
                  || r.output.revised
                  || r.output.revised_text
                  || '';
        changesSummary = r.output.changes_summary || '';
        cutPct = r.output.cut_percentage;
      }
      if (!suggestion || typeof suggestion !== 'string') {
        sugEl.innerHTML = `<div class="suggest" style="border-color:var(--red-border);background:var(--red-bg)"><div class="suggest-body">Script Doctor didn't return a usable revision. Try again.</div></div>`;
        return;
      }

      const pctLabel = cutPct != null ? ` · ${Math.round(cutPct * 100)}% shorter` : '';
      sugEl.innerHTML = `
        <div class="suggest">
          <div class="suggest-head">Suggested tightening · ${r.credits || 0} credits${pctLabel}</div>
          <div class="suggest-diff" style="white-space:pre-wrap">${esc(suggestion)}</div>
          ${changesSummary ? `<div class="suggest-note" style="margin-top:8px;padding:8px;background:rgba(184,146,46,0.1);border-left:2px solid var(--gold);font-size:12px;color:var(--text2)">${esc(changesSummary)}</div>` : ''}
          <div class="suggest-actions">
            <button class="btn btn-gold btn-sm" data-apply="${sceneId}">Apply</button>
            <button class="btn btn-ghost btn-sm" data-dismiss="${sceneId}">Dismiss</button>
          </div>
        </div>
      `;
      sugEl.querySelector('[data-apply]').addEventListener('click', () => {
        scene.raw = suggestion;
        saveProject(p);
        toast('Scene updated', 'ok');
        render();
      });
      sugEl.querySelector('[data-dismiss]').addEventListener('click', () => {
        sugEl.innerHTML = '';
      });
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  STEP 3 — CAST & PLACES
// ═══════════════════════════════════════════════════════════════════════
function renderCastStep(p){
  // Auto-seed from parsed script on render. Handles three cases:
  //  1. User navigated directly to /cast URL (skipped Continue button)
  //  2. Project was parsed on an older buggy version of the normalizer
  //  3. User refreshed the page before seeding happened
  // We also re-run the normalizer if the script exists but character_list is stale.
  seedCastFromScript(p, /*force*/ false);

  const chars = Object.entries(p.character_bible);
  const locs  = Object.entries(p.location_library);
  const hasScript = !!(p.script && p.script.raw);
  const rescanNotice = hasScript ? `
    <div style="margin-top:8px;font-size:12px;color:var(--text2)">
      Didn't find someone? <a href="#" id="btn-rescan-cast" style="color:var(--gold);text-decoration:underline">Re-scan the script</a>.
    </div>
  ` : '';

  return `
    <div class="main-header">
      <div class="main-title">③ Cast & Places</div>
      <div class="main-meta">Step <b>3</b> of 7</div>
    </div>
    <div class="main-body">
      <div class="main-body-inner">
        <h1 class="hero-title">Lock every character and location once.</h1>
        <p class="hero-sub">When you generate later, every shot that references these people and places pulls from the same spec. No more drift between shots.</p>

        <div class="card">
          <h2 class="card-title">Characters</h2>
          <p class="card-sub">One row per character found in your script. Write a short description; we'll polish it for consistency.</p>
          <div class="bible-list">
            ${chars.length === 0 ? '<div class="empty">No characters detected in the script yet.</div>' :
              chars.map(([name, c]) => renderCharRow(name, c)).join('')}
            <div class="btn-row">
              <button class="btn btn-ghost btn-sm" id="btn-add-char">+ Add character</button>
            </div>
          </div>
          ${rescanNotice}
        </div>

        <div class="card">
          <h2 class="card-title">Locations</h2>
          <p class="card-sub">Describe each place once. Light, weather, atmosphere — whatever gives it a feel.</p>
          <div class="bible-list">
            ${locs.length === 0 ? '<div class="empty">No locations detected in the script yet.</div>' :
              locs.map(([name, l]) => renderLocRow(name, l)).join('')}
            <div class="btn-row">
              <button class="btn btn-ghost btn-sm" id="btn-add-loc">+ Add location</button>
            </div>
          </div>
        </div>

        ${chars.length > 0 ? renderFullCrewCard(p, 'cast', 'Run full cast + environment crew', `
          6 specialists + 4 managers lock visual/psychological/voice identity for every character and structural specs for every location.
          Runs Visual Character Builder, Psychological Builder, Emotion Mapper, Voice Builder, Environment Builder, and Architecture Designer in parallel.
        `) : ''}

        <div class="btn-row" style="justify-content:flex-end;margin-top:16px">
          <button class="btn btn-gold" id="btn-continue-coverage">Continue to Coverage →</button>
        </div>
      </div>
    </div>
  `;
}

function renderCharRow(name, c){
  // v83: reference image strip — drives i2v consistency at video gen time.
  // When `reference_image_url` is set, the SB_Enricher will route every
  // shot featuring this character to image-to-video on Seedance/Veo so the
  // model literally cannot drift the face. Without a ref image, the model
  // generates from text only and produces a different face every shot.
  const hasRef = !!c.reference_image_url;
  const refStrip = `
    <div class="char-ref-strip${hasRef ? ' has-ref' : ''}">
      <div class="char-ref-thumb">
        ${hasRef
          ? `<img src="${esc(c.reference_image_url)}" alt="${esc(name)} reference" data-char-ref-img="${esc(name)}">`
          : `<div class="char-ref-placeholder">No reference yet</div>`
        }
      </div>
      <div class="char-ref-info">
        <div class="char-ref-status">
          ${hasRef
            ? '<span class="char-ref-badge ok">🔒 Reference locked</span><div class="char-ref-help">Used as i2v seed for every shot featuring ' + esc(name) + '.</div>'
            : '<span class="char-ref-badge none">No reference image</span><div class="char-ref-help">Without a reference, the model invents a new face every shot. Generate one or upload your own.</div>'
          }
        </div>
        <div class="char-ref-actions">
          <button class="btn btn-ghost btn-sm" data-action="gen-char-ref" data-char="${esc(name)}" title="Generate via Flux from the description above">🎭 ${hasRef ? 'Regenerate' : 'Generate reference'}</button>
          <button class="btn btn-ghost btn-sm" data-action="upload-char-ref" data-char="${esc(name)}" title="Upload your own reference image">📁 Upload</button>
          ${hasRef ? `<button class="btn btn-ghost btn-sm" data-action="remove-char-ref" data-char="${esc(name)}" title="Remove the reference image">✕ Remove</button>` : ''}
        </div>
      </div>
    </div>
    <div data-char-ref-status="${esc(name)}" class="char-ref-status-line"></div>
  `;
  return `
    <div class="bible-row" data-char="${esc(name)}">
      <div class="bible-head">
        <div class="bible-name">${esc(name)}</div>
        <div class="bible-meta">${c.scenes_present || 0} scene${c.scenes_present === 1 ? '' : 's'}</div>
        <button class="bible-remove" data-action="remove-char" data-char="${esc(name)}" title="Remove this character" aria-label="Remove ${esc(name)}">×</button>
      </div>
      <textarea class="bible-desc" data-char-desc="${esc(name)}" placeholder="32-year-old lanky detective, black hair, perpetual trench coat, smokes constantly...">${esc(c.canonical_description || '')}</textarea>
      ${renderCharacterLockedFields(c)}
      ${refStrip}
      <div class="btn-row" style="margin-top:10px">
        <button class="btn btn-ghost btn-sm" data-action="polish-char" data-char="${esc(name)}">✨ Polish description</button>
        <button class="btn btn-ghost btn-sm" data-action="suggest-wardrobe" data-char="${esc(name)}">✨ Suggest wardrobe</button>
      </div>
      <div data-sug-char="${esc(name)}"></div>
    </div>
  `;
}

function renderLocRow(name, l){
  return `
    <div class="bible-row" data-loc="${esc(name)}">
      <div class="bible-head">
        <div class="bible-name">${esc(name)}</div>
        <div class="bible-meta">location</div>
        <button class="bible-remove" data-action="remove-loc" data-loc="${esc(name)}" title="Remove this location" aria-label="Remove ${esc(name)}">×</button>
      </div>
      <textarea class="bible-desc" data-loc-desc="${esc(name)}" placeholder="A narrow walk-up office, one window, yellowed blinds, rain outside...">${esc(l.description || '')}</textarea>
      ${renderLocationLockedFields(l)}
      <div class="btn-row" style="margin-top:10px">
        <button class="btn btn-ghost btn-sm" data-action="describe-loc" data-loc="${esc(name)}">✨ Describe this location</button>
      </div>
      <div data-sug-loc="${esc(name)}"></div>
    </div>
  `;
}

// ── Locked fields display ─────────────────────────────────────────────
// After crew runs write data to character_bible / location_library, show
// what was written inline so the user can see their Apply actions took
// effect. Without this, fields like core_wound, voice_signature, wardrobe
// are invisible — user thinks nothing applied.
function renderLockedFieldRow(label, value) {
  if (value == null || value === '') return '';
  let display;
  if (Array.isArray(value)) {
    if (!value.length) return '';
    display = value.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(', ');
  } else if (typeof value === 'object') {
    const kv = Object.entries(value).filter(([, v]) => v != null && v !== '');
    if (!kv.length) return '';
    display = kv.map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · ');
  } else {
    display = String(value);
  }
  return `<div class="locked-row"><span class="locked-key">${esc(label)}</span><span class="locked-val">${esc(display)}</span></div>`;
}

function renderCharacterLockedFields(c) {
  if (!c) return '';
  const rows = [];
  // Visual / wardrobe
  if (c.visual_anchors?.length)         rows.push(renderLockedFieldRow('Visual anchors', c.visual_anchors));
  if (c.consistency_phrase)             rows.push(renderLockedFieldRow('Consistency phrase', c.consistency_phrase));
  if (c.wardrobe_default)               rows.push(renderLockedFieldRow('Wardrobe', c.wardrobe_default));
  if (c.signature_props?.length)        rows.push(renderLockedFieldRow('Signature props', c.signature_props));
  if (c.period_notes)                   rows.push(renderLockedFieldRow('Period', c.period_notes));
  // Psychology
  if (c.core_wound)                     rows.push(renderLockedFieldRow('Core wound', c.core_wound));
  if (c.external_desire)                rows.push(renderLockedFieldRow('External desire', c.external_desire));
  if (c.internal_desire)                rows.push(renderLockedFieldRow('Internal desire', c.internal_desire));
  if (c.obstacle)                       rows.push(renderLockedFieldRow('Obstacle', c.obstacle));
  if (c.arc_trajectory)                 rows.push(renderLockedFieldRow('Arc', c.arc_trajectory));
  if (c.moral_flaw)                     rows.push(renderLockedFieldRow('Moral flaw', c.moral_flaw));
  if (c.ghost)                          rows.push(renderLockedFieldRow('Ghost', c.ghost));
  // Voice
  if (c.voice_signature)                rows.push(renderLockedFieldRow('Voice', c.voice_signature));
  if (c.vocab_register)                 rows.push(renderLockedFieldRow('Register', c.vocab_register));
  if (c.sentence_length)                rows.push(renderLockedFieldRow('Sentence length', c.sentence_length));
  if (c.speech_patterns)                rows.push(renderLockedFieldRow('Speech patterns', c.speech_patterns));
  if (c.never_says)                     rows.push(renderLockedFieldRow('Never says', c.never_says));
  if (c.regional_markers)               rows.push(renderLockedFieldRow('Regional', c.regional_markers));
  if (c.voice_distinctness_score != null) rows.push(renderLockedFieldRow('Voice score', c.voice_distinctness_score));
  if (c.voice_notes)                    rows.push(renderLockedFieldRow('Voice notes', c.voice_notes));
  if (!rows.length) return '';
  return `
    <div class="locked-panel" data-locked="char">
      <div class="locked-head">✓ Applied from crew runs</div>
      <div class="locked-rows">${rows.join('')}</div>
    </div>
  `;
}

function renderLocationLockedFields(l) {
  if (!l) return '';
  const rows = [];
  if (l.establishing_prompt)    rows.push(renderLockedFieldRow('Establishing prompt', l.establishing_prompt));
  if (l.sensory_anchors?.length) rows.push(renderLockedFieldRow('Sensory anchors', l.sensory_anchors));
  if (l.scale)                   rows.push(renderLockedFieldRow('Scale', l.scale));
  if (l.era)                     rows.push(renderLockedFieldRow('Era', l.era));
  if (l.materials)               rows.push(renderLockedFieldRow('Materials', l.materials));
  if (l.weathering)              rows.push(renderLockedFieldRow('Weathering', l.weathering));
  if (l.architecture_style)      rows.push(renderLockedFieldRow('Architecture', l.architecture_style));
  if (l.architectural_signature) rows.push(renderLockedFieldRow('Signature', l.architectural_signature));
  if (l.building_type)           rows.push(renderLockedFieldRow('Building', l.building_type));
  if (l.set_dressing)            rows.push(renderLockedFieldRow('Set dressing', l.set_dressing));
  if (l.worldbuilding_hooks)     rows.push(renderLockedFieldRow('Worldbuilding hooks', l.worldbuilding_hooks));
  if (l.wall_dressing)           rows.push(renderLockedFieldRow('Walls', l.wall_dressing));
  if (l.surface_dressing)        rows.push(renderLockedFieldRow('Surfaces', l.surface_dressing));
  if (!rows.length) return '';
  return `
    <div class="locked-panel" data-locked="loc">
      <div class="locked-head">✓ Applied from crew runs</div>
      <div class="locked-rows">${rows.join('')}</div>
    </div>
  `;
}

// Seed the Cast step's bible + library from a parsed script.
// - If force=true, re-parse the raw script and replace parsed scenes (recovers
//   from older buggy parses where character_list was empty/stale).
// - If force=false, only fills empty entries — doesn't clobber user's work.
function seedCastFromScript(p, force) {
  if (!p || !p.script) return;
  p.character_bible = p.character_bible || {};
  p.location_library = p.location_library || {};

  // Force re-parse from raw so post-upgrade normalizer fixes get applied.
  if (force && p.script.raw && window.SB_Normalize && window.SB_Normalize.normalizeScript) {
    try {
      p.script.normalized = window.SB_Normalize.normalizeScript(p.script.raw);
    } catch (e) {
      console.warn('Re-parse failed:', e);
    }
  }

  const n = p.script.normalized;
  if (!n) return;

  // Seed characters — union approach: add any character in the list that
  // doesn't already have a bible entry. Never clobbers existing entries.
  if (Array.isArray(n.character_list)) {
    n.character_list.forEach(c => {
      const name = c.name || c;
      if (!name) return;
      if (!p.character_bible[name]) {
        p.character_bible[name] = {
          canonical_description: '',
          reference_image_url: null,
          wardrobe_default: '',
          scenes_present: c.scenes_present_count || 1,
        };
      } else if (c.scenes_present_count && !p.character_bible[name].scenes_present) {
        p.character_bible[name].scenes_present = c.scenes_present_count;
      }
    });
  }

  // Seed locations from scene slugs — same union discipline.
  if (Array.isArray(n.scenes)) {
    const locs = new Set();
    n.scenes.forEach(s => {
      if (s.setting && s.setting.location) locs.add(s.setting.location);
    });
    [...locs].forEach(loc => {
      if (!p.location_library[loc]) {
        p.location_library[loc] = {
          description: '',
          reference_image_url: null,
          atmospherics: { time_of_day: '', weather: '', mood: '' },
        };
      }
    });
  }
}

function wireCastStep(p){
  wireCrewButton(p, 'cast');

  // v85: One-way bridge from Media Hub's legacy `rD.characterImages` /
  // `p.characterBible[].imageUrl` (storage key `SB_Project_v2`) into the
  // workflow's `character_bible[name].reference_image_url`. If the user
  // generated character images in Media Hub before v83 added the native
  // workflow strip, those URLs would otherwise be stranded — invisible to
  // the prompt enricher. This sync runs idempotently every time the user
  // lands on Cast & Places, only filling gaps (never clobbering).
  try {
    let synced = 0;
    // Source 1: Media Hub's `rD`-style scratch storage (project_v1 key)
    const mhRaw = localStorage.getItem('SB_Project_v1');
    if (mhRaw) {
      try {
        const mh = JSON.parse(mhRaw);
        const ci = mh && mh.characterImages;
        if (ci && typeof ci === 'object') {
          Object.entries(ci).forEach(([name, url]) => {
            if (!url || typeof url !== 'string') return;
            const c = p.character_bible[name];
            if (c && !c.reference_image_url) {
              c.reference_image_url = url;
              c.reference_image_at = Date.now();
              synced++;
            }
          });
        }
      } catch(e){ /* malformed legacy storage — ignore */ }
    }
    // Source 2: Media Hub's bible-style storage (project_v2 key)
    const mh2Raw = localStorage.getItem('SB_Project_v2');
    if (mh2Raw) {
      try {
        const mh2 = JSON.parse(mh2Raw);
        const cb = mh2 && mh2.characterBible;
        if (Array.isArray(cb)) {
          cb.forEach(entry => {
            if (!entry || !entry.name || !entry.imageUrl) return;
            const c = p.character_bible[entry.name];
            if (c && !c.reference_image_url) {
              c.reference_image_url = entry.imageUrl;
              c.reference_image_at = Date.now();
              synced++;
            }
          });
        }
      } catch(e){ /* malformed legacy storage — ignore */ }
    }
    if (synced > 0) {
      saveProject(p);
      toast(`Synced ${synced} reference image${synced === 1 ? '' : 's'} from Media Hub`, 'ok');
      console.log('[v85 ref-bridge] synced', synced, 'reference images from Media Hub storage');
    }
  } catch(e) {
    console.warn('[v85 ref-bridge] sync skipped:', e.message);
  }

  // Re-scan script button — forces re-parse with current normalizer and
  // re-seeds the bible/library. Useful after normalizer upgrades or when
  // initial seeding missed characters.
  document.getElementById('btn-rescan-cast')?.addEventListener('click', (e) => {
    e.preventDefault();
    const beforeChars = Object.keys(p.character_bible).length;
    const beforeLocs = Object.keys(p.location_library).length;
    seedCastFromScript(p, /*force*/ true);
    saveProject(p);
    const afterChars = Object.keys(p.character_bible).length;
    const afterLocs = Object.keys(p.location_library).length;
    const gained = (afterChars - beforeChars) + (afterLocs - beforeLocs);
    if (gained > 0) {
      toast(`Re-scanned — added ${afterChars - beforeChars} character${afterChars - beforeChars === 1 ? '' : 's'}, ${afterLocs - beforeLocs} location${afterLocs - beforeLocs === 1 ? '' : 's'}`, 'ok');
    } else if (afterChars === 0 && afterLocs === 0) {
      toast('No characters or locations found in the script. Try formatting character names in ALL CAPS on their own line.', 'err');
    } else {
      toast(`Scan complete — ${afterChars} character${afterChars === 1 ? '' : 's'}, ${afterLocs} location${afterLocs === 1 ? '' : 's'} total`, 'ok');
    }
    render();
  });

  // Save on blur for char/loc descriptions
  document.querySelectorAll('[data-char-desc]').forEach(ta => {
    ta.addEventListener('blur', () => {
      const name = ta.dataset.charDesc;
      if (p.character_bible[name]) {
        p.character_bible[name].canonical_description = ta.value.trim();
        saveProject(p);
      }
    });
  });
  document.querySelectorAll('[data-loc-desc]').forEach(ta => {
    ta.addEventListener('blur', () => {
      const name = ta.dataset.locDesc;
      if (p.location_library[name]) {
        p.location_library[name].description = ta.value.trim();
        saveProject(p);
      }
    });
  });

  // Add character / location
  document.getElementById('btn-add-char')?.addEventListener('click', () => {
    const name = (prompt('Character name?') || '').trim();
    if (!name) return;
    if (p.character_bible[name]) { toast('Already exists', 'err'); return; }
    p.character_bible[name] = { canonical_description: '', reference_image_url: null, wardrobe_default: '', scenes_present: 0 };
    saveProject(p); render();
  });
  document.getElementById('btn-add-loc')?.addEventListener('click', () => {
    const name = (prompt('Location name?') || '').trim();
    if (!name) return;
    if (p.location_library[name]) { toast('Already exists', 'err'); return; }
    p.location_library[name] = { description: '', reference_image_url: null, atmospherics: {} };
    saveProject(p); render();
  });

  // Remove character — used to clear out script-parser false positives
  // (e.g. "SOME", "PRE", "FADE OUT" picked up as character cues).
  // The normalizer's character_list is rebuilt from scene dialogue on the
  // next re-parse; if this character still shows up there and the user
  // re-runs parse, it'll come back. That's fine — the remove is per-bible
  // only, not a script edit.
  document.querySelectorAll('[data-action="remove-char"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.char;
      if (!name) return;
      if (!confirm(`Remove "${name}" from the character bible? This won't change your script — if you re-parse, it may come back.`)) return;
      delete p.character_bible[name];
      saveProject(p);
      toast(`Removed "${name}"`, 'ok');
      render();
    });
  });

  document.querySelectorAll('[data-action="remove-loc"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.loc;
      if (!name) return;
      if (!confirm(`Remove "${name}" from the location library? This won't change your script — if you re-parse, it may come back.`)) return;
      delete p.location_library[name];
      saveProject(p);
      toast(`Removed "${name}"`, 'ok');
      render();
    });
  });

  // Polish character description — Character Sculptor
  document.querySelectorAll('[data-action="polish-char"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.char;
      const c = p.character_bible[name];
      const ta = document.querySelector(`[data-char-desc="${CSS.escape(name)}"]`);
      const current = (ta?.value || c.canonical_description || '').trim();
      // No gate — if empty, Character Sculptor infers from script context via buildContext.
      // Mirrors how Location Scout works (which runs fine from an empty description).
      const std = current ? window.SB_Normalize.standardizeCharacterBrief(current) : { tags: [] };
      const stop = showSpinnerOn(btn);
      const r = await invokeAgent('character-sculptor', JSON.stringify({
        name,
        current_description: current || '',
        standardized_tags: std.tags,
        scenes_present: c.scenes_present || 0,
        instruction: current
          ? 'Return a polished, reusable character prompt (50 words max) optimized for consistency across Flux image generations and video generation. Return only the polished description as plain text.'
          : `No description yet — build one from scratch using the script context in [CONTEXT FROM UPSTREAM AGENTS] (character dialogue, scenes, actions). Infer age, build, hair, wardrobe, demeanor from what the script shows. Return a polished, reusable character prompt (50 words max) optimized for Flux image generation + video-gen consistency. Return only the description as plain text.`,
      }, null, 2), { context: buildContext(p, null, {lean: true}) });
      stop();
      const sugEl = document.querySelector(`[data-sug-char="${CSS.escape(name)}"]`);
      if (!r.ok) { sugEl.innerHTML = `<div class="suggest" style="border-color:var(--red-border);background:var(--red-bg)"><div class="suggest-body">${esc(r.error)}</div></div>`; return; }
      const polished = typeof r.output === 'string' ? r.output : (
        r.output.canonical_description ||
        r.output.polished ||
        r.output.description ||
        ''
      );
      if (!polished) {
        sugEl.innerHTML = `<div class="suggest" style="border-color:var(--red-border);background:var(--red-bg)"><div class="suggest-body">Character Sculptor returned no usable description. Try again.</div></div>`;
        return;
      }
      // Also capture visual_anchors + consistency_phrase from the upgraded schema
      const anchors = Array.isArray(r.output.visual_anchors) ? r.output.visual_anchors : [];
      const consistencyPhrase = r.output.consistency_phrase || '';
      const extraInfo = (anchors.length || consistencyPhrase) ? `
        <div class="suggest-note" style="margin-top:8px;padding:8px;background:rgba(184,146,46,0.1);border-left:2px solid var(--gold);font-size:12px;color:var(--text2)">
          ${anchors.length ? `<b>Visual anchors:</b> ${esc(anchors.join(', '))}<br>` : ''}
          ${consistencyPhrase ? `<b>Consistency phrase:</b> ${esc(consistencyPhrase)}` : ''}
        </div>
      ` : '';
      sugEl.innerHTML = `
        <div class="suggest">
          <div class="suggest-head">Polished description · ${r.credits || 0} credits</div>
          <div class="suggest-diff">${esc(polished)}</div>
          ${extraInfo}
          <div class="suggest-actions">
            <button class="btn btn-gold btn-sm" data-apply-char="${esc(name)}">Apply</button>
            <button class="btn btn-ghost btn-sm" data-dismiss-char="${esc(name)}">Dismiss</button>
          </div>
        </div>
      `;
      sugEl.querySelector('[data-apply-char]').addEventListener('click', () => {
        p.character_bible[name].canonical_description = polished;
        // Persist anchors + consistency phrase for use by Prompt Smith downstream
        if (anchors.length) p.character_bible[name].visual_anchors = anchors;
        if (consistencyPhrase) p.character_bible[name].consistency_phrase = consistencyPhrase;
        saveProject(p); render();
      });
      sugEl.querySelector('[data-dismiss-char]').addEventListener('click', () => { sugEl.innerHTML = ''; });
    });
  });

  // Suggest wardrobe
  document.querySelectorAll('[data-action="suggest-wardrobe"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.char;
      const c = p.character_bible[name];
      const stop = showSpinnerOn(btn);
      const r = await invokeAgent('wardrobe-props', JSON.stringify({
        character_name: name,
        character_description: c.canonical_description,
        instruction: 'Suggest a signature wardrobe and 1-2 signature props. Return as {wardrobe: string, props: [string]}.',
      }, null, 2), { context: buildContext(p, null, {lean: true}) });
      stop();
      const sugEl = document.querySelector(`[data-sug-char="${CSS.escape(name)}"]`);
      if (!r.ok) { sugEl.innerHTML = `<div class="suggest" style="border-color:var(--red-border);background:var(--red-bg)"><div class="suggest-body">${esc(r.error)}</div></div>`; return; }
      const out = r.output || {};
      // Upgraded Wardrobe & Props schema returns wardrobe_default + signature_props.
      // Fall back to legacy wardrobe/props for compatibility.
      const wardrobe = out.wardrobe_default || out.wardrobe || '';
      const props = out.signature_props || out.props || [];
      const periodNotes = out.period_notes || '';
      const text = typeof r.output === 'string'
        ? r.output
        : `Wardrobe: ${wardrobe}\nProps: ${props.join(', ')}${periodNotes ? '\nPeriod notes: ' + periodNotes : ''}`;
      if (!wardrobe && !props.length) {
        sugEl.innerHTML = `<div class="suggest" style="border-color:var(--red-border);background:var(--red-bg)"><div class="suggest-body">Wardrobe & Props returned no usable suggestion. Try again.</div></div>`;
        return;
      }
      sugEl.innerHTML = `
        <div class="suggest">
          <div class="suggest-head">Wardrobe & props suggestion · ${r.credits || 0} credits</div>
          <div class="suggest-diff" style="white-space:pre-wrap">${esc(text)}</div>
          <div class="suggest-actions">
            <button class="btn btn-gold btn-sm" data-apply-wd="${esc(name)}">Save to character</button>
            <button class="btn btn-ghost btn-sm" data-dismiss-wd="${esc(name)}">Dismiss</button>
          </div>
        </div>
      `;
      sugEl.querySelector('[data-apply-wd]').addEventListener('click', () => {
        p.character_bible[name].wardrobe_default = wardrobe;
        p.character_bible[name].signature_props = props;
        p.character_bible[name].props = props;  // legacy field kept for compat
        if (periodNotes) p.character_bible[name].period_notes = periodNotes;
        saveProject(p); toast('Saved to ' + name, 'ok'); sugEl.innerHTML = '';
      });
      sugEl.querySelector('[data-dismiss-wd]').addEventListener('click', () => { sugEl.innerHTML = ''; });
    });
  });

  // ─── Character reference image handlers (v83) ────────────────────────
  // Reference images are the ONLY reliable way to keep faces consistent
  // across video shots. When set, the prompt enricher routes every shot
  // featuring this character to image-to-video on Seedance/Veo, seeding
  // generation from this image. Without it, models invent a new face per
  // shot and "The Last Client" becomes "The Last 12 Clients."

  // Generate via Flux from the character's description (Character Sculptor's
  // canonical_description if applied, otherwise the raw textarea contents).
  document.querySelectorAll('[data-action="gen-char-ref"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.char;
      const c = p.character_bible[name];
      if (!c) { toast('Character not found', 'err'); return; }
      const descTA = document.querySelector(`[data-char-desc="${CSS.escape(name)}"]`);
      const description = (descTA?.value || c.canonical_description || '').trim();
      if (!description) {
        toast('Add a description first — click "Polish description" or type one.', 'err');
        return;
      }
      const statusEl = document.querySelector(`[data-char-ref-status="${CSS.escape(name)}"]`);
      const setStatus = (msg, kind) => {
        if (!statusEl) return;
        const color = kind === 'err' ? '#c07070' : kind === 'ok' ? '#6abe7f' : 'var(--text2)';
        statusEl.innerHTML = `<span style="color:${color};font-size:11px">${esc(msg)}</span>`;
      };

      // Confirm cost up-front (Flux Dev = 15 credits per gen for non-owners)
      const isOwner = !!window.SB_OWNER_TOKEN;
      const confirmMsg = isOwner
        ? `Generate reference image for ${name} via Flux Dev? (owner — no charge)`
        : `Generate reference image for ${name} via Flux Dev? Costs 15 credits. Without a reference, every shot featuring ${name} will use a different face.`;
      if (!confirm(confirmMsg)) return;

      btn.disabled = true;
      const stop = showSpinnerOn(btn);
      setStatus('Submitting to Flux Dev…');

      try {
        const headers = await authHeaders();
        // Build the same kind of "reference sheet" prompt Character Studio uses —
        // multi-angle, neutral background, photorealistic. This format gives
        // Seedance/Veo the strongest face anchor when used as i2v seed.
        const prompt = `Full body character reference sheet. ${name}: ${description}. Neutral studio lighting, white seamless background, multiple angles showing front, side, and 3/4 view. Highly detailed, photorealistic.`;
        const r = await fetch('/.netlify/functions/generate-character', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            action: 'generate',
            model: 'flux-dev',
            prompt,
            aspect_ratio: '1:1',
          }),
        });
        const d = await r.json();
        if (!r.ok) {
          const err = d?.error || d?.message || ('HTTP ' + r.status);
          setStatus('Failed: ' + err, 'err');
          toast('Reference generation failed: ' + err, 'err');
          return;
        }
        const url = d.image_url;
        if (!url) {
          setStatus('No image URL returned', 'err');
          toast('Flux returned no image URL', 'err');
          return;
        }
        // Persist to project's character_bible. The enricher reads this
        // exact field at staging time.
        p.character_bible[name].reference_image_url = url;
        p.character_bible[name].reference_image_at = Date.now();
        p.character_bible[name].reference_image_required = true;
        saveProject(p);
        setStatus('Reference locked ✓', 'ok');
        toast(`Reference image locked for ${name}${isOwner ? '' : ' (' + (d.charged || 15) + ' credits)'}`, 'ok');
        render();
      } catch (e) {
        console.error('[gen-char-ref]', e);
        setStatus('Network error: ' + e.message, 'err');
        toast('Network error: ' + e.message, 'err');
      } finally {
        stop();
        btn.disabled = false;
      }
    });
  });

  // Upload a custom reference image — bypasses Flux entirely. Useful when
  // the user has casting headshots, mood-board references, or AI images
  // generated elsewhere they want to lock as the canonical face.
  document.querySelectorAll('[data-action="upload-char-ref"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.char;
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/jpeg,image/png,image/webp';
      inp.onchange = async () => {
        const f = inp.files?.[0];
        if (!f) return;
        if (f.size > 8 * 1024 * 1024) {  // 8MB cap — fal.ai accepts up to 10MB
          toast('Image too large (max 8MB)', 'err');
          return;
        }
        const statusEl = document.querySelector(`[data-char-ref-status="${CSS.escape(name)}"]`);
        const setStatus = (msg, kind) => {
          if (!statusEl) return;
          const color = kind === 'err' ? '#c07070' : kind === 'ok' ? '#6abe7f' : 'var(--text2)';
          statusEl.innerHTML = `<span style="color:${color};font-size:11px">${esc(msg)}</span>`;
        };
        setStatus('Uploading…');
        try {
          // Read as base64 + send to upload endpoint. The generate-video
          // function exposes an upload_image action that hosts it on fal's
          // CDN and returns a stable URL — same pattern as Media Hub's
          // legacy character image upload.
          const dataUrl = await new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(r.result);
            r.onerror = () => rej(new Error('Read failed'));
            r.readAsDataURL(f);
          });
          const headers = await authHeaders();
          const r = await fetch('/.netlify/functions/generate-video', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              action: 'upload_image',
              image_data_url: dataUrl,
              filename: f.name,
            }),
          });
          const d = await r.json();
          if (!r.ok || !d.url) {
            const err = d?.error || ('HTTP ' + r.status);
            setStatus('Upload failed: ' + err, 'err');
            toast('Upload failed: ' + err, 'err');
            return;
          }
          p.character_bible[name].reference_image_url = d.url;
          p.character_bible[name].reference_image_at = Date.now();
          p.character_bible[name].reference_image_required = true;
          saveProject(p);
          setStatus('Reference uploaded ✓', 'ok');
          toast(`Reference image uploaded for ${name}`, 'ok');
          render();
        } catch (e) {
          console.error('[upload-char-ref]', e);
          setStatus('Upload error: ' + e.message, 'err');
          toast('Upload error: ' + e.message, 'err');
        }
      };
      inp.click();
    });
  });

  document.querySelectorAll('[data-action="remove-char-ref"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.char;
      if (!confirm(`Remove the reference image for ${name}? Future shots will use text-to-video and the face will drift between clips.`)) return;
      delete p.character_bible[name].reference_image_url;
      delete p.character_bible[name].reference_image_at;
      delete p.character_bible[name].reference_image_required;
      saveProject(p);
      toast(`Reference removed for ${name}`, 'ok');
      render();
    });
  });

  // Describe location — Location Scout
  document.querySelectorAll('[data-action="describe-loc"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.loc;
      const l = p.location_library[name];
      const stop = showSpinnerOn(btn);
      const r = await invokeAgent('location-scout', JSON.stringify({
        location_name: name,
        current_description: l.description || '',
        instruction: 'Describe this location for generation — setting, light, atmosphere, texture. One paragraph. Return as plain text.',
      }, null, 2), { context: buildContext(p, null, {lean: true}) });
      stop();
      const sugEl = document.querySelector(`[data-sug-loc="${CSS.escape(name)}"]`);
      if (!r.ok) { sugEl.innerHTML = `<div class="suggest" style="border-color:var(--red-border);background:var(--red-bg)"><div class="suggest-body">${esc(r.error)}</div></div>`; return; }
      // Location Scout's upgraded schema returns {locations: [{name, description, establishing_prompt, sensory_anchors}]}
      // When asked about a single location it may return the object directly. Handle both.
      let description = '';
      let establishingPrompt = '';
      let sensoryAnchors = [];
      if (typeof r.output === 'string') {
        description = r.output;
      } else if (r.output && typeof r.output === 'object') {
        // Find the entry matching this location name (or use first/single entry)
        let entry = null;
        if (Array.isArray(r.output.locations) && r.output.locations.length) {
          entry = r.output.locations.find(loc =>
            (loc.name || '').toLowerCase() === name.toLowerCase()
          ) || r.output.locations[0];
        } else {
          entry = r.output;
        }
        description = entry.description || entry.paragraph || '';
        establishingPrompt = entry.establishing_prompt || '';
        sensoryAnchors = Array.isArray(entry.sensory_anchors) ? entry.sensory_anchors : [];
      }
      if (!description) {
        sugEl.innerHTML = `<div class="suggest" style="border-color:var(--red-border);background:var(--red-bg)"><div class="suggest-body">Location Scout returned no usable description. Try again.</div></div>`;
        return;
      }
      const extras = (establishingPrompt || sensoryAnchors.length) ? `
        <div class="suggest-note" style="margin-top:8px;padding:8px;background:rgba(184,146,46,0.1);border-left:2px solid var(--gold);font-size:12px;color:var(--text2)">
          ${establishingPrompt ? `<b>Establishing prompt:</b> ${esc(establishingPrompt)}<br>` : ''}
          ${sensoryAnchors.length ? `<b>Sensory anchors:</b> ${esc(sensoryAnchors.join(', '))}` : ''}
        </div>
      ` : '';
      sugEl.innerHTML = `
        <div class="suggest">
          <div class="suggest-head">Location description · ${r.credits || 0} credits</div>
          <div class="suggest-diff">${esc(description)}</div>
          ${extras}
          <div class="suggest-actions">
            <button class="btn btn-gold btn-sm" data-apply-loc="${esc(name)}">Apply</button>
            <button class="btn btn-ghost btn-sm" data-dismiss-loc="${esc(name)}">Dismiss</button>
          </div>
        </div>
      `;
      sugEl.querySelector('[data-apply-loc]').addEventListener('click', () => {
        p.location_library[name].description = description;
        if (establishingPrompt) p.location_library[name].establishing_prompt = establishingPrompt;
        if (sensoryAnchors.length) p.location_library[name].sensory_anchors = sensoryAnchors;
        saveProject(p); render();
      });
      sugEl.querySelector('[data-dismiss-loc]').addEventListener('click', () => { sugEl.innerHTML = ''; });
    });
  });

  document.getElementById('btn-continue-coverage')?.addEventListener('click', () => {
    go('project/' + p.id + '/coverage');
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  STEP 4 — COVERAGE (shot breakdown)
// ═══════════════════════════════════════════════════════════════════════
function renderCoverageStep(p){
  const hasShots = (p.shot_list || []).length > 0;
  const scenes = p.script.normalized?.scenes || [];

  // Coverage health per scene (simple heuristic for v1)
  const health = {};
  scenes.forEach(s => {
    const shotsInScene = (p.shot_list || []).filter(sh => sh.scene_id === s.id);
    if (shotsInScene.length >= 4) health[s.id] = 'green';
    else if (shotsInScene.length >= 2) health[s.id] = 'amber';
    else health[s.id] = 'red';
  });

  const greenCount = Object.values(health).filter(h => h === 'green').length;
  const amberCount = Object.values(health).filter(h => h === 'amber').length;
  const redCount   = Object.values(health).filter(h => h === 'red').length;

  // Scenes that have NO shots at all — these are the candidates for the bulk
  // "Break all uncovered" action. Scenes that just need *more* coverage have
  // their own Add-coverage button.
  const uncoveredScenes = scenes.filter(s => health[s.id] === 'red');
  const hasUncovered = uncoveredScenes.length > 0;

  // Continue gate — soft. We let the user advance with at least 50% of scenes
  // covered (was previously: 1 shot anywhere unlocks). Hard-locking the user
  // because 1-2 fade-out scenes can't be auto-broken is too brittle. We warn
  // about gaps but don't block.
  const coveragePct = scenes.length ? Math.round(((greenCount + amberCount) / scenes.length) * 100) : 0;
  const canAdvance = hasShots && (greenCount + amberCount) >= Math.max(1, Math.ceil(scenes.length * 0.5));

  return `
    <div class="main-header">
      <div class="main-title">④ Coverage</div>
      <div class="main-meta">Step <b>4</b> of 7</div>
    </div>
    <div class="main-body">
      <div class="main-body-inner">
        <h1 class="hero-title">Break every scene into shots.</h1>
        <p class="hero-sub">Coverage is how you tell the story. Your cinematographer suggests angles per scene. Your prompt smith rewrites each shot for the video model before you generate.</p>

        <div class="meter-row">
          <div class="meter green"><div class="meter-label">Well-covered</div><div class="meter-value">${greenCount}</div></div>
          <div class="meter amber"><div class="meter-label">Thin</div><div class="meter-value">${amberCount}</div></div>
          <div class="meter red"><div class="meter-label">Missing coverage</div><div class="meter-value">${redCount}</div></div>
          <div class="meter"><div class="meter-label">Shots total</div><div class="meter-value">${(p.shot_list || []).length}</div></div>
        </div>

        ${hasUncovered ? `
          <div style="margin:16px 0;padding:14px 16px;background:rgba(184,146,46,0.08);border:1px solid rgba(184,146,46,0.35);border-radius:8px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
            <div style="flex:1;min-width:240px">
              <b style="color:var(--gold)">${uncoveredScenes.length} scene${uncoveredScenes.length === 1 ? '' : 's'} ${uncoveredScenes.length === 1 ? 'has' : 'have'} no coverage yet.</b>
              <div style="font-size:12px;color:var(--text2);margin-top:4px">Break all of them in one click. Throttled 2 at a time, ~${Math.ceil(uncoveredScenes.length * 8)}s total.</div>
            </div>
            <button class="btn btn-gold btn-sm" id="btn-break-all-scenes">✨ Break ${uncoveredScenes.length} scenes</button>
          </div>
        ` : ''}

        ${scenes.length === 0 ? '<div class="empty"><h3>No scenes yet</h3>Go back to Story and parse your script first.</div>' :
          scenes.map(s => renderCoverageScene(s, p, health[s.id])).join('')}

        ${scenes.length > 0 ? renderFullCrewCard(p, 'coverage', 'Run full visual + settings crew', `
          6 specialists lock visual grammar and atmospheric/dressing detail for every scene.
          Runs Visual Director, Atmospherics Builder, Weather Coordinator, Dressing Builder, Props Master, and Set Dresser in parallel.
        `) : ''}

        ${scenes.length > 0 ? `
          <div class="btn-row" style="justify-content:space-between;align-items:center;margin-top:16px;flex-wrap:wrap;gap:12px">
            <div style="font-size:12px;color:var(--text2)">
              ${canAdvance
                ? `<b style="color:#6abe7f">${coveragePct}% covered</b> · You can continue${redCount > 0 ? `; ${redCount} scene${redCount === 1 ? ' is' : 's are'} still missing coverage but can be filled later` : ''}.`
                : `<b style="color:#c07070">${coveragePct}% covered</b> · Need at least ${Math.max(1, Math.ceil(scenes.length * 0.5))} of ${scenes.length} scenes with shots before continuing.`
              }
            </div>
            <button class="btn btn-gold" id="btn-continue-generate" ${canAdvance ? '' : 'disabled style="opacity:0.5;cursor:not-allowed"'}>Continue to Generate →</button>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

function renderCoverageScene(scene, p, healthLevel){
  const shots = (p.shot_list || []).filter(sh => sh.scene_id === scene.id);
  const badge = healthLevel === 'green' ? '<span class="badge badge-green">Well-covered</span>'
              : healthLevel === 'amber' ? '<span class="badge badge-amber">Thin</span>'
              : '<span class="badge badge-red">Needs coverage</span>';
  // If a previous break attempt failed, surface the error inline so the user
  // can see WHY without opening DevTools. Cleared automatically on next
  // successful break.
  const lastErr = p.scene_break_errors?.[scene.id];
  const errBanner = lastErr ? `
    <div style="margin:10px 16px;padding:10px 12px;background:rgba(176,48,48,0.08);border:1px solid rgba(176,48,48,0.35);border-radius:6px;font-size:12px;color:#ff9090">
      <b>Last attempt failed:</b> ${esc(lastErr.message)}
      ${lastErr.detail ? `<div style="margin-top:4px;font-family:var(--mono);font-size:10.5px;color:var(--text2);word-break:break-word">${esc(lastErr.detail)}</div>` : ''}
      <div style="margin-top:6px;font-size:11px;color:var(--text2)">Fix: try again, or edit the scene's text on Story step if it's parsing oddly.</div>
    </div>
  ` : '';
  return `
    <div class="scene" data-scene-id="${scene.id}" style="margin-top:18px">
      <div class="scene-head">
        <span class="tag">${esc(scene.id)}</span>
        <span>${esc(scene.slug)}</span>
        <span style="margin-left:auto">${badge}</span>
      </div>
      <div class="scene-body" style="max-height:140px">
        ${esc(truncate(scene.action || '', 300))}
      </div>
      ${errBanner}
      <div class="scene-actions">
        <button class="btn btn-ghost btn-sm" data-action="break-scene" data-scene-id="${scene.id}">
          ${shots.length === 0 ? '✨ Break into shots' : '✨ Re-break with fresh coverage'}
        </button>
        ${shots.length > 0 ? `
          <button class="btn btn-ghost btn-sm" data-action="add-coverage" data-scene-id="${scene.id}" title="Cinematographer finds missing angles">✨ Add missing coverage</button>
          <button class="btn btn-ghost btn-sm" data-action="plan-lighting" data-scene-id="${scene.id}" title="Lighting Designer">✨ Plan lighting</button>
          <button class="btn btn-ghost btn-sm" data-action="plan-movement" data-scene-id="${scene.id}" title="Movement Choreographer">✨ Plan camera moves</button>
        ` : ''}
        <span style="font-family:var(--mono);font-size:11px;color:var(--text2);margin-left:auto">${shots.length} shot${shots.length===1?'':'s'}</span>
      </div>
      <div data-shots="${scene.id}">
        ${shots.length ? `<div class="shot-grid" style="padding:0 16px 16px">${shots.map((sh, i) => renderShotCard(sh, i)).join('')}</div>` : ''}
      </div>
      <div data-sug-scene="${scene.id}"></div>
    </div>
  `;
}

function renderShotCard(sh, i){
  return `
    <div class="shot" data-shot-id="${sh.id}">
      <div class="shot-slot">${esc(sh.slot || 'shot ' + (i+1))}</div>
      <div class="shot-body">
        <b>Shot:</b> ${esc(sh.shot_brief?.shot || sh.description || '')}<br>
        ${sh.shot_brief?.action ? '<b>Action:</b> ' + esc(sh.shot_brief.action) + '<br>' : ''}
        ${sh.shot_brief?.mood ? '<b>Mood:</b> ' + esc(sh.shot_brief.mood) : ''}
      </div>
      <div class="shot-actions">
        <button class="btn btn-quiet" data-action="improve-shot" data-shot-id="${sh.id}">Improve</button>
        <button class="btn btn-quiet" data-action="remove-shot"  data-shot-id="${sh.id}">Remove</button>
      </div>
      <div data-sug-shot="${sh.id}"></div>
    </div>
  `;
}

function wireCoverageStep(p){
  wireCrewButton(p, 'coverage');
  // Break scene → Scene Architect + Cinematographer combo
  document.querySelectorAll('[data-action="break-scene"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const sceneId = btn.dataset.sceneId;
      const scene = p.script.normalized.scenes.find(s => s.id === sceneId);
      if (!scene) return;

      // Persist break errors per-scene so renderCoverageScene can show them
      // inline. setErr also saves and re-renders so the user sees the error
      // immediately without needing DevTools.
      const setErr = (message, detail) => {
        p.scene_break_errors = p.scene_break_errors || {};
        p.scene_break_errors[scene.id] = { message, detail: detail || '', at: Date.now() };
        saveProject(p);
        render();
      };
      const clearErr = () => {
        if (p.scene_break_errors?.[scene.id]) {
          delete p.scene_break_errors[scene.id];
          saveProject(p);
        }
      };

      const stop = showSpinnerOn(btn);
      const r = await invokeAgent('scene-architect', JSON.stringify({
        scene: {
          id: scene.id,
          slug: scene.slug,
          setting: scene.setting,
          time: scene.time,
          characters_present: scene.characters_present,
          action: scene.action,
          dialogue: scene.dialogue,
        },
        instruction: 'Break this scene into 3-6 shots with coverage logic (master, coverage, reaction, insert). For each shot return {slot, shot, action, mood, duration_target_seconds, characters_in_frame}. Return ONLY JSON in the shape {"shots":[...]} — do NOT skip, do NOT return prose. Every scene has coverage.',
      }, null, 2), { context: buildContext(p, null, {lean: true}) });
      stop();

      if (!r.ok) {
        toast(r.error, 'err');
        setErr('Agent call failed', r.error);
        return;
      }

      // Diagnose + recover from the four ways this can fail quietly:
      //   1. Agent "skipped" per SHARED_CONTEXT convention
      //   2. Output is a string (JSON parse error upstream)
      //   3. Output uses an alternate key name (shot_list / shots_list / bare array)
      //   4. Output is the right shape but contains zero shots
      if (r.output && typeof r.output === 'object' && r.output.skip) {
        toast(`Scene Architect declined: ${r.output.reason || 'no reason given'}.`, 'err');
        setErr('Scene Architect declined', r.output.reason || 'no reason given');
        console.warn('[break-scene] skip response:', r.output);
        return;
      }
      if (typeof r.output === 'string') {
        const preview = r.output.slice(0, 200);
        toast('Scene Architect returned unparseable text. See scene panel + console.', 'err');
        setErr('Unparseable output', preview + (r.output.length > 200 ? '…' : ''));
        console.warn('[break-scene] unparseable string output for', scene.slug, ':', r.output);
        return;
      }
      const rawShots = (r.output && (r.output.shots || r.output.shot_list || r.output.shots_list))
                    || (Array.isArray(r.output) ? r.output : null);
      if (!Array.isArray(rawShots) || rawShots.length === 0) {
        const keys = r.output && typeof r.output === 'object' ? Object.keys(r.output).join(', ') : 'no keys';
        toast(`Scene Architect returned no shots. See scene panel + console.`, 'err');
        setErr('No shots in response', `Output keys: ${keys}`);
        console.warn('[break-scene] no shots extracted. Raw output:', r.output);
        return;
      }

      const shots = rawShots.map((sh, i) => ({
        id: 'sh_' + scene.id + '_' + String(i+1).padStart(2, '0'),
        scene_id: scene.id,
        slot: sh.slot || 'shot ' + (i+1),
        shot_brief: { shot: sh.shot || '', action: sh.action || '', mood: sh.mood || '' },
        duration_target_seconds: sh.duration_target_seconds || 5,
        characters_in_frame: sh.characters_in_frame || [],
      }));
      // Replace any existing shots for this scene
      p.shot_list = (p.shot_list || []).filter(sh => sh.scene_id !== scene.id).concat(shots);
      clearErr();  // success → drop any stale error banner
      saveProject(p);
      const partial = r.output && r.output._truncated;
      if (partial) {
        toast(`Added ${shots.length} shots to ${scene.slug} (recovered from truncated response — click Re-break for a fresh run)`, 'ok');
      } else {
        toast(`Added ${shots.length} shots to ${scene.slug}`, 'ok');
      }
      render();
    });
  });

  // Improve shot → Prompt Smith
  document.querySelectorAll('[data-action="improve-shot"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const shotId = btn.dataset.shotId;
      const shot = p.shot_list.find(sh => sh.id === shotId);
      if (!shot) return;
      const stop = showSpinnerOn(btn);
      const current = [shot.shot_brief?.shot, shot.shot_brief?.action, shot.shot_brief?.mood].filter(Boolean).join(' | ');
      const std = window.SB_Normalize.standardizeShotBrief(current);
      const r = await invokeAgent('prompt-smith', JSON.stringify({
        current_shot: std,
        scene: p.script.normalized.scenes.find(s => s.id === shot.scene_id),
        characters: shot.characters_in_frame.map(n => p.character_bible[n]).filter(Boolean),
        target_model: shot.model_target || 'seedance-turbo',
        instruction: 'Rewrite this shot as an optimized video-gen prompt. Return {shot, action, mood, final_prompt, negative_prompt, model_target, character_refs_used}.',
      }, null, 2), { context: buildContext(p, null, {lean: true}) });
      stop();

      const sugEl = document.querySelector(`[data-sug-shot="${CSS.escape(shotId)}"]`);
      if (!r.ok) { sugEl.innerHTML = `<div class="suggest" style="border-color:var(--red-border);background:var(--red-bg)"><div class="suggest-body">${esc(r.error)}</div></div>`; return; }
      const out = r.output || {};
      if (!out.final_prompt && typeof r.output !== 'string') {
        sugEl.innerHTML = `<div class="suggest" style="border-color:var(--red-border);background:var(--red-bg)"><div class="suggest-body">Prompt Smith returned no usable prompt. Try again.</div></div>`;
        return;
      }
      const modelLabel = out.model_target ? ` · model: ${out.model_target}` : '';
      const text = typeof r.output === 'string' ? r.output
                 : `Shot: ${out.shot || ''}\nAction: ${out.action || ''}\nMood: ${out.mood || ''}\n\nFinal prompt:\n${out.final_prompt || ''}${out.negative_prompt ? '\n\nNegative prompt:\n' + out.negative_prompt : ''}`;
      sugEl.innerHTML = `
        <div class="suggest">
          <div class="suggest-head">Improved prompt · ${r.credits || 0} credits${modelLabel}</div>
          <div class="suggest-diff" style="white-space:pre-wrap">${esc(text)}</div>
          <div class="suggest-actions">
            <button class="btn btn-gold btn-sm" data-apply-shot="${esc(shotId)}">Apply</button>
            <button class="btn btn-ghost btn-sm" data-dismiss-shot="${esc(shotId)}">Dismiss</button>
          </div>
        </div>
      `;
      sugEl.querySelector('[data-apply-shot]').addEventListener('click', () => {
        if (out.shot)             shot.shot_brief.shot = out.shot;
        if (out.action)           shot.shot_brief.action = out.action;
        if (out.mood)             shot.shot_brief.mood = out.mood;
        if (out.final_prompt)     shot.final_prompt = out.final_prompt;
        if (out.negative_prompt)  shot.negative_prompt = out.negative_prompt;
        if (out.model_target)     shot.model_target = out.model_target;
        if (Array.isArray(out.character_refs_used)) shot.character_refs_used = out.character_refs_used;
        saveProject(p); render();
      });
      sugEl.querySelector('[data-dismiss-shot]').addEventListener('click', () => { sugEl.innerHTML = ''; });
    });
  });

  // Remove shot
  document.querySelectorAll('[data-action="remove-shot"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.shotId;
      if (!confirm('Remove this shot?')) return;
      p.shot_list = p.shot_list.filter(sh => sh.id !== id);
      saveProject(p); render();
    });
  });

  // Add missing coverage → Cinematographer
  document.querySelectorAll('[data-action="add-coverage"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const sceneId = btn.dataset.sceneId;
      const scene = p.script.normalized.scenes.find(s => s.id === sceneId);
      const existingShots = p.shot_list.filter(sh => sh.scene_id === sceneId);
      if (!scene) return;
      const stop = showSpinnerOn(btn);
      const r = await invokeAgent('cinematographer',
        JSON.stringify({
          scene: { id: scene.id, slug: scene.slug, action: scene.action, characters_present: scene.characters_present },
          existing_shots: existingShots.map(s => ({ slot: s.slot, shot: s.shot_brief?.shot, action: s.shot_brief?.action })),
          instruction: 'What coverage is missing? Propose 1-3 additional shots (master / close-up / reaction / insert / OTS / wide) that fill gaps. For each return {slot, shot, action, mood, framing, lens, duration_target_seconds, characters_in_frame, reason}. Return {additional_shots: [...]}.',
        }, null, 2),
        { context: buildContext(p, null, {lean: true}) }
      );
      stop();
      const sugEl = document.querySelector(`[data-sug-scene="${CSS.escape(sceneId)}"]`);
      if (!r.ok) { sugEl.innerHTML = `<div class="suggest" style="border-color:var(--red-border);background:var(--red-bg)"><div class="suggest-body">${esc(r.error)}</div></div>`; return; }

      // Diagnose silent failure modes before claiming "Coverage looks complete"
      if (r.output && typeof r.output === 'object' && r.output.skip) {
        sugEl.innerHTML = `<div class="suggest" style="border-color:var(--red-border);background:var(--red-bg)"><div class="suggest-body">Cinematographer declined: ${esc(r.output.reason || 'no reason given')}</div></div>`;
        return;
      }
      if (typeof r.output === 'string') {
        sugEl.innerHTML = `<div class="suggest" style="border-color:var(--red-border);background:var(--red-bg)"><div class="suggest-body">Cinematographer returned unparseable text (see console). Try again.</div></div>`;
        console.warn('[add-coverage] unparseable string output:', r.output);
        return;
      }

      const adds = (r.output && (r.output.additional_shots || r.output.shots)) || [];
      if (!adds.length) { sugEl.innerHTML = '<div class="suggest"><div class="suggest-body">Coverage looks complete to the Cinematographer.</div></div>'; return; }
      const preview = adds.map(s => `${s.slot}: ${s.shot}${s.reason ? ' — ' + s.reason : ''}`).join('\n');
      sugEl.innerHTML = `
        <div class="suggest">
          <div class="suggest-head">Additional coverage · ${r.credits || 0} credits</div>
          <div class="suggest-diff">${esc(preview)}</div>
          <div class="suggest-actions">
            <button class="btn btn-gold btn-sm" data-apply-cov="${esc(sceneId)}">Add these shots</button>
            <button class="btn btn-ghost btn-sm" data-dismiss-cov="${esc(sceneId)}">Dismiss</button>
          </div>
        </div>
      `;
      sugEl.querySelector('[data-apply-cov]').addEventListener('click', () => {
        const startIdx = p.shot_list.filter(sh => sh.scene_id === sceneId).length;
        adds.forEach((sh, i) => {
          p.shot_list.push({
            id: 'sh_' + sceneId + '_' + String(startIdx + i + 1).padStart(2, '0'),
            scene_id: sceneId,
            slot: sh.slot || 'additional',
            shot_brief: { shot: sh.shot || '', action: sh.action || '', mood: sh.mood || '' },
            duration_target_seconds: sh.duration_target_seconds || 5,
            characters_in_frame: sh.characters_in_frame || [],
            cinematography: { lens: sh.lens, framing: sh.framing },
          });
        });
        saveProject(p);
        toast('Added ' + adds.length + ' shots', 'ok');
        render();
      });
      sugEl.querySelector('[data-dismiss-cov]').addEventListener('click', () => { sugEl.innerHTML = ''; });
    });
  });

  // Plan lighting → Lighting Designer
  document.querySelectorAll('[data-action="plan-lighting"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const sceneId = btn.dataset.sceneId;
      const scene = p.script.normalized.scenes.find(s => s.id === sceneId);
      if (!scene) return;
      const stop = showSpinnerOn(btn);
      const r = await invokeAgent('lighting-designer',
        JSON.stringify({
          scene: { id: scene.id, slug: scene.slug, setting: scene.setting, time: scene.time, action: scene.action },
          instruction: 'Design the lighting plan. Return {key_light, fill_light, rim_light, motivated_source, mood_note} — each a short descriptive phrase.',
        }, null, 2),
        { context: buildContext(p, null, {lean: true}) }
      );
      stop();
      const sugEl = document.querySelector(`[data-sug-scene="${CSS.escape(sceneId)}"]`);
      if (!r.ok) { sugEl.innerHTML = `<div class="suggest" style="border-color:var(--red-border);background:var(--red-bg)"><div class="suggest-body">${esc(r.error)}</div></div>`; return; }
      // Lighting Designer's upgraded schema is {per_scene:[{scene_id, key_light, ...}]}
      // but the instruction asks for flat fields. Handle both response shapes.
      let lighting = {};
      if (typeof r.output === 'string') {
        lighting = { mood_note: r.output };
      } else if (r.output && typeof r.output === 'object') {
        if (Array.isArray(r.output.per_scene) && r.output.per_scene.length) {
          lighting = r.output.per_scene.find(x => x.scene_id === sceneId) || r.output.per_scene[0];
        } else {
          lighting = r.output;
        }
      }
      const text = `Key: ${lighting.key_light || '—'}\nFill: ${lighting.fill_light || '—'}\nRim: ${lighting.rim_light || '—'}\nMotivated source: ${lighting.motivated_source || '—'}\n\n${lighting.mood_note || ''}`;
      if (!lighting.key_light && !lighting.mood_note) {
        sugEl.innerHTML = `<div class="suggest" style="border-color:var(--red-border);background:var(--red-bg)"><div class="suggest-body">Lighting Designer returned no usable plan. Try again.</div></div>`;
        return;
      }
      sugEl.innerHTML = `
        <div class="suggest">
          <div class="suggest-head">Lighting plan · ${r.credits || 0} credits</div>
          <div class="suggest-diff" style="white-space:pre-wrap">${esc(text)}</div>
          <div class="suggest-actions">
            <button class="btn btn-gold btn-sm" data-apply-light="${esc(sceneId)}">Save to scene</button>
            <button class="btn btn-ghost btn-sm" data-dismiss-light="${esc(sceneId)}">Dismiss</button>
          </div>
        </div>
      `;
      sugEl.querySelector('[data-apply-light]').addEventListener('click', () => {
        scene.lighting_plan = lighting;
        saveProject(p); sugEl.innerHTML = ''; toast('Lighting saved', 'ok');
      });
      sugEl.querySelector('[data-dismiss-light]').addEventListener('click', () => { sugEl.innerHTML = ''; });
    });
  });

  // Plan camera movement → Movement Choreographer
  document.querySelectorAll('[data-action="plan-movement"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const sceneId = btn.dataset.sceneId;
      const scene = p.script.normalized.scenes.find(s => s.id === sceneId);
      const shots = p.shot_list.filter(sh => sh.scene_id === sceneId);
      if (!scene) return;
      const stop = showSpinnerOn(btn);
      const r = await invokeAgent('movement-choreographer',
        JSON.stringify({
          scene: { id: scene.id, slug: scene.slug, action: scene.action },
          shots: shots.map(sh => ({ id: sh.id, slot: sh.slot, shot: sh.shot_brief?.shot })),
          instruction: 'Recommend camera movement per shot — stillness vs motion, considering the pacing contract. Return {per_shot: [{shot_id, movement, rationale}]}.',
        }, null, 2),
        { context: buildContext(p, null, {lean: true}) }
      );
      stop();
      const sugEl = document.querySelector(`[data-sug-scene="${CSS.escape(sceneId)}"]`);
      if (!r.ok) { sugEl.innerHTML = `<div class="suggest" style="border-color:var(--red-border);background:var(--red-bg)"><div class="suggest-body">${esc(r.error)}</div></div>`; return; }
      const per = (r.output?.per_shot) || [];
      const text = per.length
        ? per.map(s => `${s.shot_id}: ${s.movement}${s.rationale ? ' — ' + s.rationale : ''}`).join('\n')
        : formatAgentOutput(r.output);
      sugEl.innerHTML = `
        <div class="suggest">
          <div class="suggest-head">Camera movement plan · ${r.credits || 0} credits</div>
          <div class="suggest-diff">${esc(text)}</div>
          <div class="suggest-actions">
            <button class="btn btn-gold btn-sm" data-apply-mov="${esc(sceneId)}">Save to shots</button>
            <button class="btn btn-ghost btn-sm" data-dismiss-mov="${esc(sceneId)}">Dismiss</button>
          </div>
        </div>
      `;
      sugEl.querySelector('[data-apply-mov]').addEventListener('click', () => {
        per.forEach(x => {
          const sh = p.shot_list.find(s => s.id === x.shot_id);
          if (sh) { sh.cinematography = sh.cinematography || {}; sh.cinematography.movement = x.movement; }
        });
        saveProject(p); sugEl.innerHTML = ''; toast('Movement saved', 'ok');
      });
      sugEl.querySelector('[data-dismiss-mov]').addEventListener('click', () => { sugEl.innerHTML = ''; });
    });
  });

  document.getElementById('btn-continue-generate')?.addEventListener('click', () => {
    go('project/' + p.id + '/generate');
  });

  // Bulk break — fire scene-architect on every uncovered scene with a
  // concurrency cap of 2 (matches runCrew's reliability tuning). On a 9-scene
  // script with all uncovered, ~70s wall-clock. Re-renders after each success
  // so the user sees progress live, and saves between scenes so a partial run
  // still preserves work if the user navigates away.
  document.getElementById('btn-break-all-scenes')?.addEventListener('click', async () => {
    const scenes = p.script.normalized?.scenes || [];
    const uncovered = scenes.filter(s => !(p.shot_list || []).some(sh => sh.scene_id === s.id));
    if (!uncovered.length) { toast('All scenes already have coverage.', 'ok'); return; }

    const btn = document.getElementById('btn-break-all-scenes');
    btn.disabled = true;
    const stop = showSpinnerOn(btn);
    let okCount = 0;
    let failCount = 0;

    // Worker pulls scenes off a shared queue. Two workers = concurrency 2.
    const queue = [...uncovered];
    async function worker() {
      while (queue.length) {
        const scene = queue.shift();
        if (!scene) break;
        try {
          const r = await invokeAgent('scene-architect', JSON.stringify({
            scene: {
              id: scene.id,
              slug: scene.slug,
              setting: scene.setting,
              time: scene.time,
              characters_present: scene.characters_present,
              action: scene.action,
              dialogue: scene.dialogue,
            },
            instruction: 'Break this scene into 3-6 shots with coverage logic (master, coverage, reaction, insert). For each shot return {slot, shot, action, mood, duration_target_seconds, characters_in_frame}. Return ONLY JSON in the shape {"shots":[...]} — do NOT skip, do NOT return prose. Every scene has coverage.',
          }, null, 2), { context: buildContext(p, null, {lean: true}) });

          // Reuse the same diagnostic pipeline as the per-scene break, just
          // recording errors silently per-scene instead of toasting each one.
          const recordErr = (msg, detail) => {
            p.scene_break_errors = p.scene_break_errors || {};
            p.scene_break_errors[scene.id] = { message: msg, detail: detail || '', at: Date.now() };
            failCount++;
          };
          if (!r.ok) { recordErr('Agent call failed', r.error); continue; }
          if (r.output && typeof r.output === 'object' && r.output.skip) { recordErr('Scene Architect declined', r.output.reason); continue; }
          if (typeof r.output === 'string') { recordErr('Unparseable output', r.output.slice(0, 200)); continue; }
          const rawShots = (r.output && (r.output.shots || r.output.shot_list || r.output.shots_list)) || (Array.isArray(r.output) ? r.output : null);
          if (!Array.isArray(rawShots) || rawShots.length === 0) { recordErr('No shots in response', 'Output keys: ' + (r.output && typeof r.output === 'object' ? Object.keys(r.output).join(', ') : '—')); continue; }

          const shots = rawShots.map((sh, i) => ({
            id: 'sh_' + scene.id + '_' + String(i+1).padStart(2, '0'),
            scene_id: scene.id,
            slot: sh.slot || 'shot ' + (i+1),
            shot_brief: { shot: sh.shot || '', action: sh.action || '', mood: sh.mood || '' },
            duration_target_seconds: sh.duration_target_seconds || 5,
            characters_in_frame: sh.characters_in_frame || [],
          }));
          p.shot_list = (p.shot_list || []).filter(sh => sh.scene_id !== scene.id).concat(shots);
          if (p.scene_break_errors?.[scene.id]) delete p.scene_break_errors[scene.id];
          okCount++;
          // Save after each scene so a partial run is durable.
          saveProject(p);
        } catch (e) {
          console.error('[break-all-scenes] worker error on', scene.slug, e);
          failCount++;
        }
      }
    }

    await Promise.all([worker(), worker()]);
    stop();
    btn.disabled = false;

    if (failCount === 0) {
      toast(`Broke all ${okCount} scenes into shots`, 'ok');
    } else if (okCount > 0) {
      toast(`Broke ${okCount} scenes; ${failCount} failed (errors shown in scene cards)`, 'err');
    } else {
      toast(`Failed to break any scenes — check scene cards for details`, 'err');
    }
    render();
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  STEP 5 — GENERATE (v1: route to Media Hub with shot list staged)
// ═══════════════════════════════════════════════════════════════════════
function renderGenerateStep(p){
  const shots = p.shot_list || [];
  const clips = p.clips || {};
  const clipCount = Object.keys(clips).length;
  const allClipped = shots.length > 0 && clipCount >= shots.length;
  const someClipped = clipCount > 0;

  return `
    <div class="main-header">
      <div class="main-title">⑤ Generate</div>
      <div class="main-meta">Step <b>5</b> of 7</div>
    </div>
    <div class="main-body">
      <div class="main-body-inner">
        <h1 class="hero-title">Generate the shots.</h1>
        <p class="hero-sub">We hand off to Media Hub — the proven video generation pipeline — with all your clean prompts pre-filled. Your characters, locations, and vision come with you. As each clip finishes, it syncs back here automatically.</p>

        <div class="card">
          <h2 class="card-title">${shots.length} shot${shots.length === 1 ? '' : 's'} ready to generate ${someClipped ? `· <span style="color:var(--gold)">${clipCount} clipped</span>` : ''}</h2>
          <p class="card-sub">Estimated credit cost depends on the model you pick in Media Hub. Seedance Turbo is the default.</p>
          <div class="btn-row">
            <button class="btn btn-gold" id="btn-stage-mediahub">${someClipped ? 'Resume in Media Hub →' : 'Open Media Hub with these shots →'}</button>
            <button class="btn btn-ghost" id="btn-back-coverage">← Back to Coverage</button>
            ${someClipped ? `<button class="btn ${allClipped ? 'btn-gold' : 'btn-ghost'}" id="btn-advance-edit">
              ${allClipped ? '✓ All clips generated — continue to Edit →' : `Continue to Edit with ${clipCount} clip${clipCount === 1 ? '' : 's'} →`}
            </button>` : ''}
          </div>
        </div>

        ${shots.length > 0 ? renderFullCrewCard(p, 'generate', 'Run full generation crew', `
          3 specialists optimize your prompts for maximum video quality before you burn credits.
          Runs Prompt Writer (strategy + model allocation), Shot Calibrator (per-model prompt variants for Kling/Veo/Hailuo/Seedance), and VFX Supervisor (post-production flags with hour estimates).
        `) : ''}

        ${someClipped ? `
          <div class="card">
            <h2 class="card-title">Generated clips · ${clipCount}</h2>
            <div class="shot-grid">
              ${Object.entries(clips).slice(0, 12).map(([key, c]) => `
                <div class="shot-card" style="padding:10px">
                  ${c.url ? `<video src="${esc(c.url)}" preload="metadata" muted style="width:100%;border-radius:6px;background:#000"></video>` : ''}
                  <div style="font-family:var(--mono);font-size:11px;color:var(--text2);margin-top:6px">
                    ${esc(key)}${c.model ? ` · ${esc(c.model)}` : ''}
                  </div>
                </div>
              `).join('')}
            </div>
            ${clipCount > 12 ? `<div style="color:var(--text2);font-size:12px;margin-top:10px">…and ${clipCount - 12} more</div>` : ''}
          </div>
        ` : ''}

        <div class="card">
          <h2 class="card-title">What's ready to go</h2>
          ${shots.length === 0 ? '<div class="empty">No shots yet — go back to Coverage.</div>' : `
            <div class="shot-grid">${shots.slice(0, 12).map((sh, i) => renderShotCard(sh, i)).join('')}</div>
            ${shots.length > 12 ? `<div style="color:var(--text2);font-size:12px;margin-top:10px">…and ${shots.length - 12} more</div>` : ''}
          `}
        </div>
      </div>
    </div>
  `;
}
function wireGenerateStep(p){
  wireCrewButton(p, 'generate');
  document.getElementById('btn-back-coverage')?.addEventListener('click', () => go('project/' + p.id + '/coverage'));
  document.getElementById('btn-advance-edit')?.addEventListener('click', () => go('project/' + p.id + '/edit'));

  // Passive Continuity Supervisor check — silent background run when the
  // Generate step opens. If it finds warnings, inline them above the CTA.
  (async () => {
    if (!(p.shot_list || []).length) return;
    const r = await runPassive('continuity-supervisor',
      JSON.stringify({
        shot_list: p.shot_list.map(sh => ({ id: sh.id, scene_id: sh.scene_id, slot: sh.slot, characters_in_frame: sh.characters_in_frame, shot_brief: sh.shot_brief })),
        character_bible: p.character_bible,
        instruction: 'Scan for continuity issues across shots — wardrobe drift, prop disappearance, character presence inconsistencies. Return {warnings: [{shot_ids: [string], issue: string, severity: "low"|"medium"|"high"}]}.',
      }, null, 2),
      p,
      (out) => {
        const warnings = out.warnings || [];
        if (!warnings.length) return;
        const host = document.querySelector('.main-body-inner');
        if (!host) return;
        const el = document.createElement('div');
        el.className = 'suggest';
        el.style.borderColor = 'var(--amber-border)';
        el.style.background = 'var(--amber-bg)';
        el.innerHTML = `
          <div class="suggest-head" style="color:var(--amber)">Continuity warnings · ${warnings.length}</div>
          <div class="suggest-diff">${esc(warnings.map(w => `[${w.severity}] ${w.issue} (${(w.shot_ids || []).join(', ')})`).join('\n'))}</div>
        `;
        // Insert above the "Open Media Hub" card
        const firstCard = host.querySelector('.card');
        if (firstCard) host.insertBefore(el, firstCard);
        else host.appendChild(el);
      }
    );
  })();

  document.getElementById('btn-stage-mediahub')?.addEventListener('click', () => {
    // Stage the shot list + context into localStorage so Media Hub can pick it up.
    // v83: every shot's prompt is now built by SB_Enricher, which injects
    // character anchors (consistency_phrase + visual_anchors), wardrobe,
    // visual grammar (lens, framing, palette), lighting plan, weather,
    // and the project-level negative prompt. Auto-routes to i2v when a
    // character_bible entry has a reference_image_url. Without enrichment
    // (pre-v83), prompts were just "shot + action + mood" which is why
    // every clip looked completely different from every other clip.
    const enrichedShots = (window.SB_Enricher && window.SB_Enricher.buildStagedShots)
      ? window.SB_Enricher.buildStagedShots(p, { model: 'seedance-turbo' })
      : (p.shot_list || []).map(sh => ({
          id: sh.id,
          prompt: sh.final_prompt || [sh.shot_brief?.shot, sh.shot_brief?.action, sh.shot_brief?.mood].filter(Boolean).join(', '),
          scene_id: sh.scene_id,
          slot: sh.slot,
          duration: sh.duration_target_seconds || 5,
        }));
    // v85.1 staging fix: previously we only sent {project_id, project_title, vision, shots}.
    // That meant Media Hub Step 1 (Lock Script) showed only the project title, Step 2
    // (Characters) showed "No characters detected", and Step 3 (Settings) was empty —
    // because the script body, character_bible, and location_library never crossed
    // the bridge. We now stage the full upstream context so the Media Hub steps can
    // render the work the user already did in the workflow.
    const stagedScenes = (p.script?.normalized?.scenes || []).map(sc => ({
      id: sc.id,
      slug: sc.slug || '',
      heading: sc.slug || '',                // Media Hub reads scene.heading
      setting: sc.setting || { type: 'unknown', location: '' },
      time: sc.time || '',
      characters_present: sc.characters_present || [],
      action: sc.action || '',
      raw: sc.raw || '',
    }));
    const staged = {
      project_id: p.id,
      project_title: p.title,
      vision: p.vision,
      // Full screenplay text — feeds Media Hub Step 1 textarea (was being clobbered
      // with project_title before).
      script_raw: (p.script && p.script.raw) || '',
      script_normalized: p.script?.normalized || null,
      // Per-scene structure with proper INT./EXT. headings — needed so the Step 3
      // background drafter (`draftBackgroundFromScene`) can parse location/time/exterior
      // flags. Without this it can't auto-draft anything sensible.
      scenes: stagedScenes,
      // Workflow-shape character bible. Receiver translates dict → Media Hub array.
      character_bible: p.character_bible || {},
      // Workflow-shape location library. Receiver maps per-scene by setting.location.
      location_library: p.location_library || {},
      shots: enrichedShots,
    };
    try {
      localStorage.setItem('SB_WorkflowStaged', JSON.stringify(staged));
    } catch (e) {
      toast('Staging failed: ' + e.message, 'err');
      return;
    }
    // Open Media Hub INLINE in the workflow shell — no page navigation.
    // Hides the shot-staging cards, injects an iframe that loads app.html
    // in Media Hub mode. When clips generate, they sync back via localStorage.
    const host = document.querySelector('.main-body-inner');
    if (!host) {
      toast('Unable to open Media Hub pane', 'err');
      return;
    }
    host.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h1 class="hero-title" style="margin:0">Generate shots in Media Hub</h1>
        <button class="btn btn-ghost btn-sm" id="btn-close-mediahub">← Back to shot list</button>
      </div>
      <p class="hero-sub">${(p.shot_list || []).length} shots staged. Pick a model, click Generate. Clips sync back automatically as they complete.</p>
      <div class="card" style="padding:0;overflow:hidden;border-radius:12px;position:relative">
        <iframe
          id="sb-mediahub-frame"
          src="/app.html#media?embed=1"
          style="width:100%;height:80vh;border:0;background:var(--panel)"
          title="SHOTBREAK Media Hub"
          allow="clipboard-write; cross-origin-isolated"
          onload="window.__sbMediaHubLoaded=true"
        ></iframe>
        <div id="sb-mediahub-fallback" style="display:none;position:absolute;inset:0;background:var(--surface2,#111);padding:40px;text-align:center">
          <h3 style="color:var(--gold);margin-bottom:12px">Media Hub didn't load</h3>
          <p style="color:var(--text2);margin-bottom:20px;max-width:500px;margin-left:auto;margin-right:auto">The inline Media Hub couldn't start — might be a browser iframe restriction. You can open it in a new tab instead and your shots will sync back automatically.</p>
          <a class="btn btn-gold" href="/app.html#media" target="_blank" rel="noopener">Open Media Hub in new tab →</a>
        </div>
      </div>
      <p style="color:var(--text2);font-size:12px;margin-top:12px;text-align:center">
        When you're done generating, close this pane to continue to Edit.
      </p>
    `;
    // After 4 seconds, if the iframe hasn't fired its onload, show the fallback.
    setTimeout(() => {
      if (!window.__sbMediaHubLoaded) {
        const fb = document.getElementById('sb-mediahub-fallback');
        if (fb) fb.style.display = 'block';
      }
    }, 4000);
    document.getElementById('btn-close-mediahub')?.addEventListener('click', () => {
      // Re-render the Generate step, which will pick up any new clips from localStorage.
      const latest = getProject(p.id);
      if (latest) { Object.assign(p, latest); render(); }
      else render();
    });
  });

  // Auto-refresh the view when clips arrive via Media Hub write-back in another tab.
  //
  // v85.1 hotfix (the freeze fix): in v85 the reverse write-back was a silent
  // no-op (it read SB_WorkflowStaged.project_id which mhEnter had already
  // deleted), so this storage listener never fired in practice. v85.1 made
  // write-back actually work — which means EVERY clip completion in the
  // Media Hub iframe now triggers a `storage` event on this parent window,
  // which calls render(), which rebuilds the workflow Generate step DOM,
  // which destroys the iframe element, which kills the in-flight WaveSpeed
  // polls, which orphans the running jobs (they show as "Retry" because
  // their polls died), and the new iframe immediately writes again →
  // re-render → destroy → repeat. That loop saturates the main thread and
  // Chrome shows "Page Unresponsive".
  //
  // The listener was originally written for cross-tab sync. When the iframe
  // is mounted in this same window, skip the re-render — the user is looking
  // at the iframe, not the wrapper, and the wrapper will pick up the latest
  // state when they close the pane via the "Back to shot list" handler above.
  // De-dupe the storage listener — renderGenerateStep can be called many times
  // per session as the user navigates back and forth. Without this, every
  // render adds a new listener and a single Media Hub clip update fires N
  // times, multiplying re-renders and burning the main thread.
  if (window._sbStorageListener) {
    window.removeEventListener('storage', window._sbStorageListener);
  }
  const onStorage = (e) => {
    if (e.key !== 'SB_Projects_v1') return;
    if (document.getElementById('sb-mediahub-frame')) return;
    const latest = getProject(p.id);
    if (latest && Object.keys(latest.clips || {}).length !== Object.keys(p.clips || {}).length) {
      render();
    }
  };
  window._sbStorageListener = onStorage;
  window.addEventListener('storage', onStorage);
}

// ═══════════════════════════════════════════════════════════════════════
//  STEP 6 — EDIT
//  The actual timeline editor lives at /editor/. Here we expose four
//  post-production agents that review the user's current cut and suggest
//  changes. Showrunner is the orchestrator for this step.
// ═══════════════════════════════════════════════════════════════════════
function renderEditStep(p){
  const hasTimeline = !!(p.timeline && p.timeline.clips && p.timeline.clips.length);
  const clipCount   = Object.keys(p.clips || {}).length;
  return `
    <div class="main-header">
      <div class="main-title">⑥ Edit</div>
      <div class="main-meta">Step <b>6</b> of 7</div>
    </div>
    <div class="main-body">
      <div class="main-body-inner">
        <h1 class="hero-title">Cut your film.</h1>
        <p class="hero-sub">Drag your ${clipCount} clip${clipCount === 1 ? '' : 's'} onto the timeline in the Editor. When your cut feels right, come back and mark it done — your Showrunner will review, four specialists will polish.</p>

        <div class="card">
          <h2 class="card-title">Open the Editor</h2>
          <p class="card-sub">Your ${clipCount} generated clip${clipCount === 1 ? '' : 's'} ${clipCount === 1 ? 'is' : 'are'} waiting. Arrange, trim, transition, export.</p>
          <div class="btn-row">
            <a href="/editor/" class="btn btn-gold" target="_blank" rel="noopener">Open Editor →</a>
            <button class="btn ${hasTimeline ? 'btn-gold' : 'btn-ghost'}" id="btn-mark-cut-done">${hasTimeline ? '✓ Cut marked done' : 'My cut is done →'}</button>
          </div>
          <div style="font-size:12px;color:var(--text2);margin-top:8px">The Editor opens in a new tab so you can keep this step open for reference.</div>
        </div>

        <div class="card">
          <h2 class="card-title">Showrunner review ${hasTimeline ? '' : '<span class="badge" style="margin-left:8px">mark cut done to unlock</span>'}</h2>
          <p class="card-sub">Full orchestrator pass — continuity, pacing, audio balance, and a recommended cut.</p>
          <div class="btn-row">
            <button class="btn btn-gold" id="btn-showrunner" ${hasTimeline ? '' : 'disabled'}>✨ Review my cut (50 credits)</button>
          </div>
          <div id="sr-out"></div>
        </div>

        <div class="card">
          <h2 class="card-title">Post-production specialists</h2>
          <p class="card-sub">Targeted passes. Each returns human-readable notes the Editor can act on.</p>
          <div class="btn-row">
            <button class="btn btn-ghost" id="btn-editor-ai" ${hasTimeline ? '' : 'disabled'}>✨ Suggest edits (20 credits)</button>
            <button class="btn btn-ghost" id="btn-pacing" ${hasTimeline ? '' : 'disabled'}>✨ Check pacing (5 credits)</button>
            <button class="btn btn-ghost" id="btn-transitions" ${hasTimeline ? '' : 'disabled'}>✨ Suggest transitions (5 credits)</button>
          </div>
          <div id="edit-out"></div>
        </div>

        ${hasTimeline ? renderFullCrewCard(p, 'edit', 'Run full edit crew', `
          3 specialists analyze cut structure, pacing, and runtime against your Vision Director's contract.
          Runs Timeline Editor (cut structure + trim strategy + match/J/L-cut placements), Pacing Editor (breathing vs acceleration beats), and Runtime Calculator (per-scene estimates with variance tracking).
        `) : ''}

        <div class="btn-row" style="justify-content:flex-end;margin-top:16px">
          <button class="btn btn-ghost" id="btn-back-generate">← Back to Generate</button>
          <button class="btn btn-gold" id="btn-continue-deliver" ${hasTimeline ? '' : 'disabled'}>Continue to Deliver →</button>
        </div>
      </div>
    </div>
  `;
}

function wireEditStep(p){
  wireCrewButton(p, 'edit');
  document.getElementById('btn-back-generate')?.addEventListener('click', () => go('project/' + p.id + '/generate'));
  document.getElementById('btn-continue-deliver')?.addEventListener('click', () => go('project/' + p.id + '/deliver'));

  // "My cut is done" — marks the edit step as complete with a stub timeline
  // built from the project's clips. When the editor gets a real save-timeline
  // hook later, this can be upgraded to pull the actual arrangement from the
  // editor's state. For now, acknowledging completion is what matters.
  document.getElementById('btn-mark-cut-done')?.addEventListener('click', () => {
    const clipEntries = Object.entries(p.clips || {});
    if (clipEntries.length === 0) {
      toast('Generate some clips first.', 'err');
      return;
    }
    // Build a lightweight timeline stub so isStepComplete(p, 'edit') returns true
    p.timeline = p.timeline || {};
    p.timeline.clips = clipEntries.map(([key, c], i) => ({
      id:       key,
      order:    i,
      url:      c.url,
      start:    i * (c.duration || 5),
      duration: c.duration || 5,
      scene:    c.scene,
      shot:     c.shot,
    }));
    p.timeline.marked_done_at = Date.now();
    saveProject(p);
    toast('Cut marked done. Showrunner and specialists unlocked.', 'ok');
    render();
  });

  const out = document.getElementById('edit-out');
  const sr  = document.getElementById('sr-out');

  const agentBtn = (btnId, agentId, instruction, heading, targetEl) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const stop = showSpinnerOn(btn);
      const r = await invokeAgent(agentId,
        JSON.stringify({ timeline: p.timeline, vision: p.vision, instruction }, null, 2),
        { context: buildContext(p, null, {lean: true}) }
      );
      stop();
      const el = targetEl || out;
      if (!r.ok) { el.innerHTML = `<div class="suggest" style="border-color:var(--red-border);background:var(--red-bg)"><div class="suggest-body">${esc(r.error)}</div></div>`; return; }
      const text = formatAgentOutput(r.output);
      el.innerHTML = `<div class="suggest"><div class="suggest-head">${heading} · ${r.credits || 0} credits</div><div class="suggest-diff" style="white-space:pre-wrap">${esc(text)}</div></div>`;
    });
  };

  agentBtn('btn-showrunner', 'showrunner',
    'Review this full cut. Return continuity_issues, pacing_notes, recommended_cut, audio_notes, sign_off, sign_off_reason.',
    'Showrunner review', sr);
  agentBtn('btn-editor-ai', 'editor',
    'Propose specific cut decisions for this timeline. Return {edits: [{clip_id, change, reason}]} — keep it human-readable.',
    'Edit suggestions');
  agentBtn('btn-pacing', 'pacing-doctor',
    'Check the pacing against the vision pacing_contract and target length. Flag slow or rushed sections. Return {current_runtime_seconds, target_runtime_seconds, issues: [{where, problem, fix}]}.',
    'Pacing check');
  agentBtn('btn-transitions', 'transition-designer',
    'Recommend transitions between clips (hard_cut, dissolve, fade, match_cut, j_cut, l_cut). Return {per_edge: [{from_clip_id, to_clip_id, transition, reason}]}.',
    'Transition recommendations');
}

// ═══════════════════════════════════════════════════════════════════════
//  STEP 7 — DELIVER
// ═══════════════════════════════════════════════════════════════════════
function renderDeliverStep(p){
  const delivered = !!p.final_export_at;
  return `
    <div class="main-header">
      <div class="main-title">⑦ Deliver</div>
      <div class="main-meta">Step <b>7</b> of 7</div>
    </div>
    <div class="main-body">
      <div class="main-body-inner">
        <h1 class="hero-title">${delivered ? 'Delivered.' : 'Ship it.'}</h1>
        <p class="hero-sub">${delivered ? 'This project is marked complete — ' + relativeDate(p.final_export_at) + '. You can still run polish passes and re-export any time.' : 'Render the final cut from the Editor. Before you export, your post-production team can suggest sound, music, and final grade direction.'}</p>

        <div class="card">
          <h2 class="card-title">Final render</h2>
          <p class="card-sub">Export from the Editor as MP4.</p>
          <a href="/editor/" target="_blank" rel="noopener" class="btn btn-gold">Open Editor to render →</a>
        </div>

        <div class="card">
          <h2 class="card-title">Sound & music direction</h2>
          <p class="card-sub">Pre-render suggestions for SFX, foley, and score.</p>
          <div class="btn-row">
            <button class="btn btn-ghost" id="btn-sound">✨ SFX direction (15 credits)</button>
            <button class="btn btn-ghost" id="btn-music">✨ Score direction (5 credits)</button>
          </div>
          <div id="sound-out"></div>
        </div>

        <div class="card">
          <h2 class="card-title">Color grade direction</h2>
          <p class="card-sub">Final grade notes tied to the project palette.</p>
          <div class="btn-row">
            <button class="btn btn-ghost" id="btn-colorist">✨ Grade direction (5 credits)</button>
          </div>
          <div id="color-out"></div>
        </div>

        <div class="card">
          <h2 class="card-title">Cut a trailer</h2>
          <p class="card-sub">60-second trailer plan from your shot list, with music cue recommendations.</p>
          <button class="btn btn-ghost" id="btn-trailer">✨ Generate trailer plan (15 credits)</button>
          <div id="trailer-out"></div>
        </div>

        <div class="card">
          <h2 class="card-title">Final polish check</h2>
          <p class="card-sub">Runs the Polish Pass on everything. Returns a checklist.</p>
          <button class="btn btn-ghost" id="btn-polish">✨ Run final check (5 credits)</button>
          <div id="polish-out"></div>
        </div>

        <div class="card" style="border-color:var(--gold-border);background:var(--gold-bg)">
          <h2 class="card-title">${delivered ? 'Delivery confirmed' : 'Mark project delivered'}</h2>
          <p class="card-sub">${delivered ? 'The project is archived with a timestamp. All steps are now checkmarked.' : 'When the final render is complete and you\'re happy with it, close the project out. This locks in the delivery date and marks all 7 steps done.'}</p>
          <div class="btn-row">
            <button class="btn ${delivered ? 'btn-ghost' : 'btn-gold'}" id="btn-mark-delivered">
              ${delivered ? '✓ Delivered — re-open project' : '✓ Mark as delivered'}
            </button>
            <button class="btn btn-ghost" id="btn-back-projects">← All projects</button>
          </div>
        </div>
      </div>
    </div>
  `;
}
function wireDeliverStep(p){
  // Mark-delivered / un-mark
  document.getElementById('btn-mark-delivered')?.addEventListener('click', () => {
    if (p.final_export_at) {
      if (!confirm('Re-open this project? The delivery timestamp will be cleared.')) return;
      p.final_export_at = null;
      saveProject(p);
      toast('Project re-opened.', 'ok');
    } else {
      p.final_export_at = Date.now();
      saveProject(p);
      toast('Project delivered. 🎬', 'ok');
    }
    render();
  });
  document.getElementById('btn-back-projects')?.addEventListener('click', () => go('projects'));

  const agentCall = async (btnId, agentId, inputObj, instruction, heading, outId) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const stop = showSpinnerOn(btn);
      const r = await invokeAgent(agentId,
        JSON.stringify({ ...inputObj, instruction }, null, 2),
        { context: buildContext(p, null, {lean: true}) }
      );
      stop();
      const out = document.getElementById(outId);
      if (!r.ok) { out.innerHTML = `<div class="suggest" style="border-color:var(--red-border);background:var(--red-bg)"><div class="suggest-body">${esc(r.error)}</div></div>`; return; }
      const txt = formatAgentOutput(r.output);
      out.innerHTML = `<div class="suggest"><div class="suggest-head">${heading} · ${r.credits || 0} credits</div><div class="suggest-diff" style="white-space:pre-wrap">${esc(txt)}</div></div>`;
    });
  };

  agentCall('btn-sound', 'sound-designer',
    { shot_list: p.shot_list, timeline: p.timeline },
    'Recommend SFX and foley per shot. Return {per_shot: [{shot_id, sfx: [string], foley: [string]}]}.',
    'SFX direction', 'sound-out');

  agentCall('btn-music', 'music-supervisor',
    { vision: p.vision, shot_list: p.shot_list },
    'Score direction — genre, tempo, cue points. Return {overall_direction, genre, bpm_range, cue_points: [{seconds, intent}]}.',
    'Score direction', 'sound-out');

  agentCall('btn-colorist', 'colorist',
    { vision: p.vision, shot_list: p.shot_list, timeline: p.timeline },
    'Final grade direction. Return {overall_look, per_scene_notes: [{scene_id, notes}], references}.',
    'Grade direction', 'color-out');

  agentCall('btn-trailer', 'trailer-cutter',
    { project: { title: p.title, vision: p.vision, shot_list: p.shot_list } },
    'Propose a 60-second trailer structure. Return {beats: [{seconds, content, music_cue}]}.',
    'Trailer plan', 'trailer-out');

  agentCall('btn-polish', 'polish-pass',
    { project: { title: p.title, vision: p.vision, shot_list: p.shot_list, timeline: p.timeline } },
    'Run a final polish checklist across continuity, pacing, color, audio, coverage. Return {checklist: [{axis, status, note}]}.',
    'Polish pass', 'polish-out');
}

// ═══════════════════════════════════════════════════════════════════════
//  Utilities
// ═══════════════════════════════════════════════════════════════════════
function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function truncate(s, n){ s = String(s || ''); return s.length > n ? s.slice(0, n).trim() + '...' : s; }
function capitalize(s){ s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
function relativeDate(ts){
  if (!ts) return 'never';
  const d = Date.now() - ts;
  if (d < 60e3) return 'just now';
  if (d < 3600e3) return Math.floor(d/60e3) + 'm ago';
  if (d < 86400e3) return Math.floor(d/3600e3) + 'h ago';
  return Math.floor(d/86400e3) + 'd ago';
}

})();
