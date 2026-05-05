// ═══════════════════════════════════════════════════════════════════════════
// SHOTBREAK — Agent Client (frontend) — FIXED FOR DISPLAY + APPLY
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const INVOKE_URL = '/.netlify/functions/agent-invoke';

let currentAgentOutput = null;

// Load all agents and render buttons
async function loadAgentMeta() {
  try {
    const res = await fetch('/.netlify/functions/agent-meta');
    const { agents } = await res.json();

    renderAgentButtons(agents);
  } catch (e) {
    console.error('Failed to load agent meta', e);
  }
}

function renderAgentButtons(agents) {
  const container = document.getElementById('agent-buttons-container') || createAgentContainer();
  
  container.innerHTML = '<h3>GODLY AI FILM CREW</h3>';
  
  agents.forEach(agent => {
    const btn = document.createElement('button');
    btn.className = 'agent-btn';
    btn.textContent = agent.name;
    btn.onclick = () => invokeAgent(agent.id);
    container.appendChild(btn);
  });
}

function createAgentContainer() {
  const div = document.createElement('div');
  div.id = 'agent-buttons-container';
  div.style.cssText = 'position:fixed; bottom:20px; left:20px; background:#111; padding:15px; border-radius:8px; max-width:280px; z-index:9999; box-shadow:0 0 20px rgba(0,0,0,0.8);';
  document.body.appendChild(div);
  return div;
}

// Call an agent and show result
async function invokeAgent(agent_id) {
  const inputField = document.getElementById('agent-input') || { value: prompt('Enter prompt for this agent:') || '' };
  const input = inputField.value || 'Run full analysis on current scene';

  const payload = { agent_id, input };

  try {
    const res = await fetch(INVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (data.error) {
      alert('Agent error: ' + data.error);
      return;
    }

    // Store output and show it
    currentAgentOutput = data.raw || data;
    showAgentOutput(data.raw || JSON.stringify(data, null, 2), agent_id);
  } catch (e) {
    console.error(e);
    alert('Failed to contact agent');
  }
}

function showAgentOutput(rawText, agent_id) {
  let panel = document.getElementById('agent-output-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'agent-output-panel';
    panel.style.cssText = 'position:fixed; top:20px; right:20px; width:420px; background:#1a1a1a; color:#0f0; padding:15px; border-radius:8px; z-index:10000; max-height:80vh; overflow:auto; box-shadow:0 0 30px rgba(0,255,0,0.3); font-family:monospace; font-size:13px;';
    document.body.appendChild(panel);
  }

  panel.innerHTML = `
    <h4>✅ ${agent_id.toUpperCase()} OUTPUT</h4>
    <pre style="background:#000; padding:10px; max-height:400px; overflow:auto;">${rawText}</pre>
    <button onclick="applyAgentOutput()" style="background:#0f0; color:#000; padding:8px 16px; border:none; border-radius:4px; font-weight:bold; margin-top:10px;">APPLY CHANGES TO PROJECT</button>
    <button onclick="this.parentElement.remove()" style="margin-left:10px; background:#666; color:#fff; padding:8px 16px; border:none; border-radius:4px;">Close</button>
  `;
}

// Apply the last agent output using existing appliers
window.applyAgentOutput = async function() {
  if (!currentAgentOutput) return alert('No output to apply');

  try {
    // This calls the existing appliers.js logic (already in your project)
    const event = new CustomEvent('apply-agent-output', { detail: { raw: currentAgentOutput } });
    document.dispatchEvent(event);

    alert('✅ Changes applied! Check your shot list / scene.');
    // Optional: auto-refresh workflow state
    if (typeof window.refreshWorkflow === 'function') window.refreshWorkflow();
  } catch (e) {
    console.error(e);
    alert('Apply failed — check console');
  }
};

// Auto-start
document.addEventListener('DOMContentLoaded', loadAgentMeta);
console.log('🚀 Shotbreak Agent Client v2 — FIXED (display + apply)');
