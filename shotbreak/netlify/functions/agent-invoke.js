'use strict';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'https://shotbreak.io',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      }
    };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const { agent_id, input } = payload;

    // GROK CALL
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROK_SHOTBREAK_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: "grok-3",
        max_tokens: 1500,
        temperature: 0.75,
        messages: [
          { role: "system", content: "You are a helpful creative film agent." },
          { role: "user", content: String(input || "Say hello") }
        ]
      })
    });

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "No response";

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'https://shotbreak.io',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        raw: text,
        model_used: 'grok-3'
      })
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
