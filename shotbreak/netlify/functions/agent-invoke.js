'use strict';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' } };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const input = payload.input || "Test input";

    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROK_SHOTBREAK_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: "grok-3",
        max_tokens: 1000,
        temperature: 0.8,
        messages: [
          { role: "system", content: "You are Vision-Director. Give raw, cinematic answers." },
          { role: "user", content: String(input) }
        ]
      })
    });

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "Grok is working";

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'https://shotbreak.io',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ raw: text, model_used: 'grok-3' })
    };

  } catch (e) {
    return {
      statusCode: 502,
      headers: { 'Access-Control-Allow-Origin': 'https://shotbreak.io' },
      body: JSON.stringify({ error: "Failed", detail: e.message })
    };
  }
};
