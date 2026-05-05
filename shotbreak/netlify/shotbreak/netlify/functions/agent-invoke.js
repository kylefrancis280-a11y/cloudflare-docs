'use strict';

const { getAgent } = require('../../agents/registry');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': 'https://shotbreak.io' } };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const { agent_id, input } = payload;

    const agent = getAgent(agent_id);

    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROK_SHOTBREAK_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: "grok-3",
        max_tokens: agent.max_tokens,
        temperature: agent.temperature,
        messages: [
          { role: "system", content: agent.systemPrompt },
          { role: "user", content: String(input || "Test") }
        ]
      })
    });

    if (!res.ok) throw new Error(`Grok error ${res.status}`);

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "Grok responded";

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'https://shotbreak.io',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ raw: text, model_used: 'grok-3' })
    };

  } catch (e) {
    console.error(e);
    return {
      statusCode: 502,
      headers: { 'Access-Control-Allow-Origin': 'https://shotbreak.io' },
      body: JSON.stringify({ error: "Agent failed", detail: e.message })
    };
  }
};
