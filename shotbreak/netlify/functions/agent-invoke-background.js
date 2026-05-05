'use strict';

const { getStore } = require('@netlify/blobs');
const { getAgent } = require('../../agents/registry');
const { verifyToken, getOrCreateUser, setCredits } = require('./lib/auth');

const GROK_URL = 'https://api.x.ai/v1/chat/completions';

function getJobStore() {
  return getStore({ name: 'agent_jobs', consistency: 'strong' });
}

async function writeJob(docId, fields) {
  const store = getJobStore();
  let existing = {};
  try {
    const raw = await store.get(docId);
    if (raw) existing = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {}
  await store.set(docId, JSON.stringify({ ...existing, ...fields }));
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200 };

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400 }; }

  const { agent_id, input, context, job_id: clientJobId } = payload;
  if (!clientJobId) return { statusCode: 400 };

  let auth;
  try { auth = await verifyToken(event); } catch { return { statusCode: 401 }; }

  const docId = `${auth.uid}_${String(clientJobId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)}`;

  try {
    await writeJob(docId, { uid: auth.uid, agent_id: agent_id || 'unknown', status: 'running', createdAt: new Date() });
  } catch (e) { return { statusCode: 500 }; }

  const fail = async (code, msg) => {
    await writeJob(docId, { status: 'error', error: msg, completedAt: new Date() }).catch(() => {});
    return { statusCode: code };
  };

  if (!agent_id || input === undefined) return fail(400, 'Missing agent_id or input');

  let agent;
  try { agent = getAgent(agent_id); } catch { return fail(404, 'Unknown agent'); }

  // GROK ONLY
  try {
    const res = await fetch(GROK_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROK_SHOTBREAK_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: "grok-3",
        max_tokens: 1200,
        temperature: 0.8,
        messages: [
          { role: "system", content: agent.systemPrompt || "You are a creative film agent." },
          { role: "user", content: String(input) }
        ]
      })
    });

    if (!res.ok) throw new Error(`Grok HTTP ${res.status}`);

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "Grok responded";

    await writeJob(docId, {
      status: 'complete',
      output: text,
      raw: text,
      model_used: 'grok-3',
      completedAt: new Date()
    });

    return { statusCode: 200 };
  } catch (e) {
    return fail(502, e.message);
  }
};
