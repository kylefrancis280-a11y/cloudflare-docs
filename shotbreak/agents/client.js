'use strict';

window.SB_Agents = window.SB_Agents || {};

async function loadGodlyCrew() {
  try {
    const res = await fetch('/.netlify/functions/agent-meta');
    const data = await res.json();
    window.SB_Agents.list = data.agents || [];
    console.log('%c✅ GODLY CREW LOADED — ' + window.SB_Agents.list.length + ' agents', 'color:#0f0;font-size:14px');
    renderButtons();
  } catch(e) { console.error(e); }
}

function renderButtons() {
  const container = document.getElementById('agent-buttons') || 
                    document.querySelector('.agent-grid') || 
                    document.querySelector('.workflow-controls') || 
                    document.body;

  container.innerHTML = '<h3 style="color:#0ff;margin:15px 0">GODLY FILM CREW</h3>';

  window.SB_Agents.list.forEach(agent => {
    const btn = document.createElement('button');
    btn.style.cssText = 'margin:4px 8px;padding:14px 20px;background:#111;color:#0ff;border:2px solid #0ff;border-radius:6px;cursor:pointer;font-weight:bold;min-width:180px';
    btn.innerHTML = `${agent.name}<br><small>${agent.id}</small>`;
    btn.onclick = () => runAgent(agent.id);
    container.appendChild(btn);
  });
}

async function runAgent(agent_id) {
  const input = prompt(`Running ${agent_id}\n\nPaste scene / logline / shot list:`, '');
  if (!input) return;

  const res = await fetch('/.netlify/functions/agent-invoke', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({agent_id, input})
  });
  const data = await res.json();
  if (data.raw) {
    console.log(`%c${agent_id} →`, 'color:#ff0', data.raw);
    alert(`${agent_id} done — check console`);
  } else if (data.error) {
    alert('Error: ' + data.detail);
  }
}

document.addEventListener('DOMContentLoaded', loadGodlyCrew);
console.log('%c🚀 Shotbreak Godly Crew UI Active', 'color:#0ff;font-size:16px');
