// ═══════════════════════════════════════════════════════════════════════════
// SHOTBREAK — Agent Client v4
// Exposes window.SB_Agents (required by app.html) + square toggle UI
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const INVOKE_URL = '/.netlify/functions/agent-invoke';
let currentAgentOutput = null;
let panelOpen = false;
let _agentsCache = [];

// ── window.SB_Agents — required by app.html ──────────────────────────────────
window.SB_Agents = {
  /**
   * Called by app.html after successful Firebase auth (loadUser).
   * Creates/initialises the Firestore user doc if needed.
   */
  bootstrap() {
    // Firestore user-doc init (non-blocking, idempotent)
    try {
      if (window.firebase && window.firebase.firestore) {
        const db   = window.firebase.firestore();
        const auth = window.firebase.auth();
        const user = auth.currentUser;
        if (user) {
          const ref = db.collection('users').doc(user.uid);
          ref.get().then(snap => {
            if (!snap.exists) {
              ref.set({
                uid:       user.uid,
                email:     user.email,
                createdAt: new Date().toISOString(),
                tier:      'creator'
              });
            }
          }).catch(() => {});
        }
      }
    } catch (_) {}

    // Kick off agent panel load (non-blocking)
    loadAgentMeta();
  }
};

// ── Bootstrap ────────────────────────────────────────────────────────────────
async function loadAgentMeta() {
  try {
    const res = await fetch('/.netlify/functions/agent-meta');
    const { agents, byDepartment } = await res.json();
    _agentsCache = agents || [];
    createToggleButton();
    createAgentPanel(_agentsCache, byDepartment || {});
  } catch (e) {
    console.error('Failed to load agent meta', e);
    // Still create the button even if meta fails
    createToggleButton();
    createAgentPanel([], {});
  }
}

// ── Square toggle button (top-left) ─────────────────────────────────────────
function createToggleButton() {
  if (document.getElementById('sb-agent-toggle')) return;
  const btn = document.createElement('button');
  btn.id = 'sb-agent-toggle';
  btn.innerHTML = '🎬';
  btn.title = 'AI Film Crew';
  btn.style.cssText = [
    'position:fixed',
    'top:16px',
    'right:16px',
    'width:44px',
    'height:44px',
    'background:#0f0',
    'color:#000',
    'border:none',
    'border-radius:6px',
    'font-size:20px',
    'cursor:pointer',
    'z-index:10001',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'box-shadow:0 2px 12px rgba(0,255,0,0.4)',
    'transition:left 0.2s'
  ].join(';');
  btn.onclick = togglePanel;
  document.body.appendChild(btn);
}

// ── Slide-out panel ──────────────────────────────────────────────────────────
function createAgentPanel(agents, byDepartment) {
  if (document.getElementById('sb-agent-panel')) return;

  const panel = document.createElement('div');
  panel.id = 'sb-agent-panel';
  panel.style.cssText = [
    'position:fixed',
    'top:0',
    'right:0',
    'width:300px',
    'height:100vh',
    'background:#0d0d0d',
    'border-left:1px solid #1a1a1a',
    'z-index:10000',
    'overflow-y:auto',
    'transform:translateX(100%)',
    'transition:transform 0.2s ease',
    'padding:70px 0 20px 0',
    'font-family:monospace'
  ].join(';');

  // Search bar
  const search = document.createElement('input');
  search.placeholder = '🔍 Search agents...';
  search.style.cssText = [
    'width:calc(100% - 24px)',
    'margin:0 12px 12px 12px',
    'padding:8px 10px',
    'background:#1a1a1a',
    'border:1px solid #333',
    'border-radius:4px',
    'color:#fff',
    'font-size:12px',
    'outline:none'
  ].join(';');
  search.oninput = () => filterAgents(search.value);
  panel.appendChild(search);

  const list = document.createElement('div');
  list.id = 'sb-agent-list';

  const deptOrder = [
    'Executive & Creative Leadership',
    'Vision & Story',
    'Production',
    'Post-Production & Editorial',
    'Sound & Audio',
    'VFX',
    'Quality & Continuity',
    'Memory & Delivery'
  ];

  // If byDepartment is populated, use it; otherwise group all agents under one section
  const hasDepts = Object.keys(byDepartment).length > 0;

  if (hasDepts) {
    for (const dept of deptOrder) {
      const deptAgents = byDepartment[dept] || [];
      if (!deptAgents.length) continue;
      list.appendChild(buildDeptSection(dept, deptAgents));
    }
  } else if (agents.length) {
    list.appendChild(buildDeptSection('AI Film Crew', agents));
  } else {
    const msg = document.createElement('div');
    msg.style.cssText = 'color:#555;font-size:11px;padding:12px;text-align:center';
    msg.textContent = 'Loading agents...';
    list.appendChild(msg);
  }

  panel.appendChild(list);
  document.body.appendChild(panel);
}

function buildDeptSection(dept, deptAgents) {
  const section = document.createElement('div');
  section.className = 'sb-dept';
  section.style.cssText = 'margin-bottom:4px';

  const header = document.createElement('div');
  header.textContent = dept;
  header.style.cssText = [
    'padding:6px 12px',
    'font-size:9px',
    'letter-spacing:1px',
    'text-transform:uppercase',
    'color:#555',
    'cursor:pointer',
    'user-select:none'
  ].join(';');

  const agentList = document.createElement('div');
  agentList.className = 'sb-dept-agents';

  deptAgents.forEach(agent => {
    const btn = document.createElement('button');
    btn.className = 'sb-agent-btn';
    btn.dataset.name = (agent.name || '').toLowerCase();
    btn.dataset.id   = agent.id || '';
    btn.textContent  = agent.name || agent.id;
    btn.style.cssText = [
      'display:block',
      'width:calc(100% - 24px)',
      'margin:2px 12px',
      'padding:7px 10px',
      'background:#111',
      'color:#ccc',
      'border:1px solid #222',
      'border-radius:4px',
      'font-size:11px',
      'text-align:left',
      'cursor:pointer',
      'transition:background 0.1s,color 0.1s'
    ].join(';');
    btn.onmouseover = () => { btn.style.background = '#0f0'; btn.style.color = '#000'; };
    btn.onmouseout  = () => { btn.style.background = '#111'; btn.style.color = '#ccc'; };
    btn.onclick = () => invokeAgent(agent.id, agent.name);
    agentList.appendChild(btn);
  });

  header.onclick = () => {
    agentList.style.display = agentList.style.display === 'none' ? 'block' : 'none';
  };

  section.appendChild(header);
  section.appendChild(agentList);
  return section;
}

function togglePanel() {
  panelOpen = !panelOpen;
  const panel = document.getElementById('sb-agent-panel');
  const btn   = document.getElementById('sb-agent-toggle');
  if (!panel || !btn) return;
  panel.style.transform = panelOpen ? 'translateX(0)' : 'translateX(100%)';
  btn.style.right = panelOpen ? '316px' : '16px';
  btn.innerHTML   = panelOpen ? '✕' : '🎬';
}

function filterAgents(query) {
  const q = (query || '').toLowerCase();
  document.querySelectorAll('.sb-agent-btn').forEach(btn => {
    btn.style.display = btn.dataset.name.includes(q) ? 'block' : 'none';
  });
}

// ── Invoke ───────────────────────────────────────────────────────────────────
async function invokeAgent(agent_id, agent_name) {
  const inputEl = document.getElementById('agent-input');
  const input   = (inputEl && inputEl.value) ||
                  window.prompt(`Prompt for ${agent_name}:`) ||
                  'Run full analysis on current scene';

  showAgentOutput('⏳ Running ' + (agent_name || agent_id) + '...', agent_id);

  try {
    const res  = await fetch(INVOKE_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ agent_id, input })
    });
    const data = await res.json();
    if (data.error) { showAgentOutput('❌ Error: ' + data.error, agent_id); return; }
    currentAgentOutput = data.raw || data;
    showAgentOutput(data.raw || JSON.stringify(data, null, 2), agent_id);
  } catch (e) {
    showAgentOutput('❌ Network error: ' + e.message, agent_id);
  }
}

// ── Output panel ─────────────────────────────────────────────────────────────
function showAgentOutput(rawText, agent_id) {
  let panel = document.getElementById('sb-output-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'sb-output-panel';
    panel.style.cssText = [
      'position:fixed',
      'top:20px',
      'right:20px',
      'width:440px',
      'max-height:80vh',
      'background:#0d0d0d',
      'color:#0f0',
      'padding:16px',
      'border-radius:8px',
      'z-index:10002',
      'overflow:auto',
      'box-shadow:0 0 30px rgba(0,255,0,0.2)',
      'font-family:monospace',
      'font-size:12px',
      'border:1px solid #1a1a1a'
    ].join(';');
    document.body.appendChild(panel);
  }

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <strong style="font-size:11px;letter-spacing:1px;text-transform:uppercase">${agent_id || ''}</strong>
      <button onclick="document.getElementById('sb-output-panel').remove()" style="background:none;border:none;color:#555;font-size:16px;cursor:pointer">✕</button>
    </div>
    <pre style="background:#000;padding:10px;border-radius:4px;max-height:50vh;overflow:auto;white-space:pre-wrap;word-break:break-word">${rawText}</pre>
    <div style="margin-top:10px;display:flex;gap:8px">
      <button onclick="applyAgentOutput()" style="flex:1;background:#0f0;color:#000;padding:8px;border:none;border-radius:4px;font-weight:bold;cursor:pointer">APPLY</button>
      <button onclick="navigator.clipboard.writeText(document.querySelector('#sb-output-panel pre').textContent)" style="background:#222;color:#fff;padding:8px 12px;border:none;border-radius:4px;cursor:pointer">COPY</button>
    </div>
  `;
}

window.applyAgentOutput = async function() {
  if (!currentAgentOutput) return alert('No output to apply');
  try {
    document.dispatchEvent(new CustomEvent('apply-agent-output', { detail: { raw: currentAgentOutput } }));
    if (typeof window.refreshWorkflow === 'function') window.refreshWorkflow();
  } catch (e) { console.error(e); }
};

// Auto-start if DOMContentLoaded already fired (script loaded late)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadAgentMeta);
} else {
  loadAgentMeta();
}

console.log('🚀 Shotbreak Agent Client v5 — SB_Agents.bootstrap + square toggle');
