'use strict';

const { getAgent } = require('../../agents/registry');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const { agent_id, input } = payload;

    if (!agent_id || !input) throw new Error('Missing agent_id or input');

    const agent = getAgent(agent_id);
    if (!agent) throw new Error(`Unknown agent: ${agent_id}`);

    // Support both env var names (fix #2)
    const apiKey = process.env.GROK_SHOTBREAK_KEY || process.env.XAI_API_KEY;
    if (!apiKey) throw new Error('No Grok API key set (GROK_SHOTBREAK_KEY or XAI_API_KEY)');

    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model:       'grok-3',
        max_tokens:  agent.max_tokens  || 1600,
        temperature: agent.temperature || 0.8,
        messages: [
          { role: 'system', content: agent.systemPrompt },
          { role: 'user',   content: String(input) }
        ]
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Grok error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || 'No response';

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ raw: text, model_used: 'grok-3', agent_id })
    };

  } catch (e) {
    console.error('[agent-invoke]', e);
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Agent invocation failed', detail: e.message })
    };
  }
};
