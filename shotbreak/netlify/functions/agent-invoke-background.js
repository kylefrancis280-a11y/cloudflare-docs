'use strict';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': 'https://shotbreak.io' } };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const { agent_id, input } = payload;

    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROK_SHOTBREAK_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: "grok-3",
        max_tokens: 1600,
        temperature: 0.85,
        messages: [
          { role: "system", content: "You are part of the ultimate AI film crew. Be extremely cinematic, detailed, and professional." },
          { role: "user", content: String(input || "Test") }
        ]
      })
    });

    if (!res.ok) throw new Error(`Grok error ${res.status}`);

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "Background Grok responded";

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
      body: JSON.stringify({ error: "Background agent failed", detail: e.message })
    };
  }
};
