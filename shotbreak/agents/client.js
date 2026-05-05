'use strict';

// SHOTBREAK — Dynamic Agent Client (loads full registry)
window.SB_Agents = window.SB_Agents || {};

async function loadAllAgents() {
  try {
    const res = await fetch('/.netlify/functions/agent-meta', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    window.SB_Agents.list = data.agents || [];
    console.log('%c✅ Loaded ' + window.SB_Agents.list.length + ' godly agents from registry', 'color:#0f0;font-weight:bold');
    renderGodlyButtons();
  } catch (e) {
    console.error('Failed to load agent meta', e);
  }
}

function renderGodlyButtons() {
  const container = document.getElementById('agent-buttons') || 
                    document.querySelector('.agent-grid') || 
                    document.querySelector('.workflow-controls') || 
                    document.body;

  // Clear old buttons if any
  container.innerHTML = '<h3 style="margin:20px 0 10px;color:#0ff">GODLY FILM CREW</h3>';

  window.SB_Agents.list.forEach(agent => {
    const btn = document.createElement('button');
    btn.style.cssText = 'margin:4px;padding:12px 16px;background:#111;color:#0ff;border:1px solid #0ff;border-radius:4px;cursor:pointer;font-weight:bold';
    btn.innerHTML = `${agent.name}<br><small style="opacity:0.6">${agent.id}</small>`;
    btn.onclick = () => runAgent(agent.id);
    container.appendChild(btn);
  });
}

async function runAgent(agent_id) {
  const input = prompt(`🚀 Running ${agent_id}\n\nPaste your scene / logline / shot list here:`, '');
  if (!input) return;

  try {
    const res = await fetch('/.netlify/functions/agent-invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id, input })
    });
    const data = await res.json();

    if (data.raw) {
      console.log(`%c${agent_id} →`, 'color:#ff0', data.raw.substring(0, 500) + '...');
      alert(`${agent_id} finished!\n\nCheck browser console (F12) for full output`);
    } else if (data.error) {
      alert('Error: ' + data.detail);
    }
  } catch (e) {
    console.error(e);
    alert('Network error — check console');
  }
}

// Auto-start when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadAllAgents);
} else {
  loadAllAgents();
}

console.log('%c🚀 Shotbreak Godly Crew — Dynamic UI Loaded', 'color:#0ff;font-size:16px;font-weight:bold');
