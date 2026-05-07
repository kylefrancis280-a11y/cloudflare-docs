'use strict';

/**
 * Netlify Function: agent-meta
 * Endpoint: /.netlify/functions/agent-meta
 * Called by client.js to populate the agent button panel.
 * Returns lightweight metadata for all 82 agents (no systemPrompts).
 */

const { getAllAgents, getAgentsByDepartment, getAgentCount } = require('../../agents/agent-meta');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const agents = getAllAgents().map(agent => ({
      id: agent.id,
      name: agent.name,
      max_tokens: agent.max_tokens,
      temperature: agent.temperature
    }));

    const byDepartment = getAgentsByDepartment();
    const count = getAgentCount();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        agents,
        byDepartment,
        count,
        model: 'grok-3'
      })
    };

  } catch (err) {
    console.error('agent-meta error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to load agent metadata', detail: err.message })
    };
  }
};
