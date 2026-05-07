'use strict';

const { getAgent } = require('../../agents/registry');

// ─── Grok invoke helper ───────────────────────────────────────────────────────
async function grokInvoke(agent, userMessage) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error('XAI_API_KEY not set');

  const body = JSON.stringify({
    model: 'grok-3',
    messages: [
      { role: 'system', content: agent.systemPrompt },
      { role: 'user', content: userMessage }
    ],
    max_tokens: agent.max_tokens || 1600,
    temperature: agent.temperature || 0.75
  });

  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Grok API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// ─── Orchestration modes ──────────────────────────────────────────────────────

/**
 * auteur_plan: Vision Director → Scene Architect → Beat Sheet Architect → Creative Prompt Writer
 * Full creative vision pipeline for a new project.
 */
async function auteurPlan(projectBrief) {
  const steps = [
    { agentId: 'vision-director', input: projectBrief },
    { agentId: 'scene-architect', inputFrom: 0 },
    { agentId: 'beat-sheet-architect', inputFrom: 0 },
    { agentId: 'creative-prompt-writer', inputFrom: 1 }
  ];

  const results = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const agent = getAgent(step.agentId);
    if (!agent) throw new Error(`Agent not found: ${step.agentId}`);
    const input = step.inputFrom !== undefined
      ? `Project Brief:\n${projectBrief}\n\nPrevious Output (${steps[step.inputFrom].agentId}):\n${results[step.inputFrom]}`
      : step.input;
    results.push(await grokInvoke(agent, input));
  }

  return {
    mode: 'auteur_plan',
    vision: results[0],
    scenes: results[1],
    beatSheet: results[2],
    prompts: results[3]
  };
}

/**
 * showrunner_cut: Head Editor → Cut Specialist → Tempo & Pacing Analyst → Final Cut Approver
 * Full editorial pipeline for an existing cut.
 */
async function showrunnerCut(cutDescription) {
  const steps = [
    { agentId: 'head-editor', input: cutDescription },
    { agentId: 'cut-specialist', inputFrom: 0 },
    { agentId: 'tempo-pacing-analyst', inputFrom: 1 },
    { agentId: 'final-cut-approver', inputFrom: 2 }
  ];

  const results = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const agent = getAgent(step.agentId);
    if (!agent) throw new Error(`Agent not found: ${step.agentId}`);
    const input = step.inputFrom !== undefined
      ? `Original Cut:\n${cutDescription}\n\nPrevious Analysis (${steps[step.inputFrom].agentId}):\n${results[step.inputFrom]}`
      : step.input;
    results.push(await grokInvoke(agent, input));
  }

  return {
    mode: 'showrunner_cut',
    editPhilosophy: results[0],
    cutBreakdown: results[1],
    pacingAnalysis: results[2],
    finalVerdict: results[3]
  };
}

/**
 * full_production: Executive Producer → Showrunner → Cinematographer → Sound Design Lead → VFX Supervisor → Final Review Orchestrator
 * Complete production pipeline from greenlight to delivery.
 */
async function fullProduction(projectData) {
  const agentSequence = [
    'executive-producer',
    'showrunner',
    'cinematographer',
    'sound-design-lead',
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

  return {
    mode: 'full_production',
    pipeline: results,
    summary: results[results.length - 1].output
  };
}

/**
 * custom_chain: Run any sequence of agents in order, each receiving the previous output.
 * agentIds: array of agent IDs
 * initialInput: string
 */
async function customChain(agentIds, initialInput) {
  if (!Array.isArray(agentIds) || agentIds.length === 0) {
    throw new Error('custom_chain requires a non-empty agentIds array');
  }

  const results = [];
  let currentInput = initialInput;

  for (const agentId of agentIds) {
    const agent = getAgent(agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    const output = await grokInvoke(agent, currentInput);
    results.push({ agentId, output });
    currentInput = `Previous output from ${agentId}:\n${output}\n\nContinue with the above context.`;
  }

  return {
    mode: 'custom_chain',
    chain: results,
    finalOutput: results[results.length - 1].output
  };
}

// ─── Netlify Function Handler ─────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid JSON body' })
    };
  }

  const { mode, input, agentIds } = body;

  if (!mode) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: 'Missing required field: mode',
        validModes: ['auteur_plan', 'showrunner_cut', 'full_production', 'custom_chain']
      })
    };
  }

  if (!input) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing required field: input' })
    };
  }

  try {
    let result;

    switch (mode) {
      case 'auteur_plan':
        result = await auteurPlan(input);
        break;
      case 'showrunner_cut':
        result = await showrunnerCut(input);
        break;
      case 'full_production':
        result = await fullProduction(input);
        break;
      case 'custom_chain':
        if (!agentIds || !Array.isArray(agentIds)) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'custom_chain requires agentIds array' })
          };
        }
        result = await customChain(agentIds, input);
        break;
      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: `Unknown mode: ${mode}`,
            validModes: ['auteur_plan', 'showrunner_cut', 'full_production', 'custom_chain']
          })
        };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, result })
    };

  } catch (err) {
    console.error('Orchestration error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Orchestration failed',
        message: err.message
      })
    };
  }
};
