'use strict';

const { getAgent } = require('../../agents/registry');
const { verifyToken } = require('./lib/auth');

const GROK_URL = 'https://api.x.ai/v1/chat/completions';

const CORS = {
  'Access-Control-Allow-Origin': 'https://shotbreak.io',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function respond(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

async function callGrok(agent, input, context) {
  const userMessage = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
  const contextualBrief = context ? `\n\n[CONTEXT]\n${JSON.stringify(context, null, 2)}` : '';

  const body = {
    model: "grok-3",
    max_tokens: agent.max_tokens || 2000,
    temperature: 0.75,
    messages: [
      { role: "system", content: agent.systemPrompt },
      { role: "user", content: `${userMessage}${contextualBrief}` }
    ]
  };

  const res = await fetch(GROK_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROK_SHOTBREAK_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Grok error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';

  let structured = null;
  if (agent.outputFormat === 'json') {
    try {
      const cleaned = text.replace(/```json\s*|\s*```/g, '').trim();
      structured = JSON.parse(cleaned);
    } catch (e) {}
  }

  return { raw: text, structured, model_used: 'grok-3' };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return respond(400, {error: 'Bad JSON'}); }

  const { agent_id, input, context } = payload;
  if (!agent_id || input === undefined) return respond(400, {error: 'Missing agent_id/input'});

  let auth;
  try { auth = await verifyToken(event); } catch { return respond(401, {error: 'Auth failed'}); }

  let agent;
  try { agent = getAgent(agent_id); } catch { return respond(404, {error: 'Unknown agent'}); }

  let result;
  try {
    result = await callGrok(agent, input, context);
  } catch (e) {
    console.error("Grok failed:", e.message);
    return respond(502, { error: "Agent invocation failed", detail: e.message });
  }

  return respond(200, result);
};
