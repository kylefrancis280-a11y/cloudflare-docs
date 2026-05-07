'use strict';

const { getAgent } = require('../../agents/registry');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

// ─── Grok invoke helper ───────────────────────────────────────────────────────
async function grokInvoke(agent, userMessage) {
  // Support both env var names (fix #2)
  const apiKey = process.env.GROK_SHOTBREAK_KEY || process.env.XAI_API_KEY;
  if (!apiKey) throw new Error('No Grok API key set (GROK_SHOTBREAK_KEY or XAI_API_KEY)');

  // Per-call timeout guard — 22s leaves headroom under Netlify's 26s limit (fix #3)
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Agent ${agent.id} timed out after 22s`)), 22000)
  );

  const call = fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json'
    },
    body: JSON.stringify({
      model:       'grok-3',
      max_tokens:  agent.max_tokens  || 1600,
      temperature: agent.temperature || 0.75,
      messages: [
        { role: 'system', content: agent.systemPrompt },
        { role: 'user',   content: userMessage }
      ]
    })
  }).then(async res => {
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Grok API error ${res.status}: ${err}`);
    }
    const data = await res.json();
    return data.choices[0].message.content;
  });

  return Promise.race([call, timeout]);
}

// ─── Orchestration modes ──────────────────────────────────────────────────────

async function auteurPlan(projectBrief) {
  const steps = [
    { agentId: 'vision-director',       input: projectBrief },
    { agentId: 'scene-architect',       inputFrom: 0 },
    { agentId: 'beat-sheet-architect',  inputFrom: 0 },
    { agentId: 'creative-prompt-writer',inputFrom: 1 }
  ];

  const results = [];
  for (let i = 0; i < steps.length; i++) {
    const step  = steps[i];
    const agent = getAgent(step.agentId);
    if (!agent) throw new Error(`Agent not found: ${step.agentId}`);
    const input = step.inputFrom !== undefined
      ? `Project Brief:\n${projectBrief}\n\nPrevious Output (${steps[step.inputFrom].agentId}):\n${results[step.inputFrom]}`
      : step.input;
    results.push(await grokInvoke(agent, input));
  }

  return { mode: 'auteur_plan', vision: results[0], scenes: results[1], beatSheet: results[2], prompts: results[3] };
}

async function showrunnerCut(cutDescription) {
  const steps = [
    { agentId: 'head-editor',          input: cutDescription },
    { agentId: 'cut-specialist',       inputFrom: 0 },
    { agentId: 'tempo-pacing-analyst', inputFrom: 1 },
    { agentId: 'final-cut-approver',   inputFrom: 2 }
  ];

  const results = [];
  for (let i = 0; i < steps.length; i++) {
    const step  = steps[i];
    const agent = getAgent(step.agentId);
    if (!agent) throw new Error(`Agent not found: ${step.agentId}`);
    const input = step.inputFrom !== undefined
      ? `Original Cut:\n${cutDescription}\n\nPrevious Analysis (${steps[step.inputFrom].agentId}):\n${results[step.inputFrom]}`
      : step.input;
    results.push(await grokInvoke(agent, input));
  }

  return { mode: 'showrunner_cut', editPhilosophy: results[0], cutBreakdown: results[1], pacingAnalysis: results[2], finalVerdict: results[3] };
}

// full_production: capped at 4 agents to stay under timeout (fix #3)
// Runs: executive-producer → showrunner → vfx-supervisor → final-review-orchestrator
async function fullProduction(projectData) {
  const agentSequence = [
    'executive-producer',
    'showrunner',
    'vfx-supervisor',
    'final-review-orchestrator'
  ];

  const results = [];
  let context = `Project Data:\n${projectData}`;

  for (const agentId of agentSequence) {
    const agent = getAgent(agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    const output = await grokInvoke(agent, context);
    results.push({ agentId, output });
    context = `${context}\n\n--- ${agentId.toUpperCase()} OUTPUT ---\n${output}`;
  }

  return { mode: 'full_production', pipeline: results, summary: results[results.length - 1].output };
}

async function customChain(agentIds, initialInput) {
  if (!Array.isArray(agentIds) || agentIds.length === 0) {
    throw new Error('custom_chain requires a non-empty agentIds array');
  }
  // Cap at 4 agents to avoid timeout (fix #3)
  const ids = agentIds.slice(0, 4);

  const results = [];
  let currentInput = initialInput;

  for (const agentId of ids) {
    const agent = getAgent(agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    const output = await grokInvoke(agent, currentInput);
    results.push({ agentId, output });
    currentInput = `Previous output from ${agentId}:\n${output}\n\nContinue with the above context.`;
  }

  return { mode: 'custom_chain', chain: results, finalOutput: results[results.length - 1].output };
}

// ─── Netlify Function Handler ─────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { mode, input, agentIds } = body;

  if (!mode) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({
      error: 'Missing required field: mode',
      validModes: ['auteur_plan', 'showrunner_cut', 'full_production', 'custom_chain']
    })};
  }

  if (!input) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing required field: input' }) };
  }

  try {
    let result;
    switch (mode) {
      case 'auteur_plan':     result = await auteurPlan(input);   break;
      case 'showrunner_cut':  result = await showrunnerCut(input); break;
      case 'full_production': result = await fullProduction(input); break;
      case 'custom_chain':
        if (!agentIds || !Array.isArray(agentIds)) {
          return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'custom_chain requires agentIds array' }) };
        }
        result = await customChain(agentIds, input);
        break;
      default:
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({
          error: `Unknown mode: ${mode}`,
          validModes: ['auteur_plan', 'showrunner_cut', 'full_production', 'custom_chain']
        })};
    }

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ success: true, result }) };

  } catch (err) {
    console.error('[agent-orchestrate]', err);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Orchestration failed', message: err.message }) };
  }
};
