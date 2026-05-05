'use strict';

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { 
      statusCode: 200, 
      headers: { 
        'Access-Control-Allow-Origin': 'https://shotbreak.io',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      } 
    };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const { agent_id, input } = payload;

    if (!agent_id || !input) {
      throw new Error("Missing agent_id or input");
    }

    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROK_SHOTBREAK_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: "grok-3",
        max_tokens: 1800,
        temperature: 0.85,
        messages: [
          { 
            role: "system", 
            content: `You are ${agent_id} — part of the ultimate AI film crew. Be extremely cinematic, detailed, creative, and professional.` 
          },
          { 
            role: "user", 
            content: String(input) 
          }
        ]
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Grok API ${res.status}: ${errorText}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "No response from Grok";

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
    console.error("Agent error:", e);
    return {
      statusCode: 502,
      headers: { 'Access-Control-Allow-Origin': 'https://shotbreak.io' },
      body: JSON.stringify({ 
        error: "Agent invocation failed", 
        detail: e.message 
      })
    };
  }
};
