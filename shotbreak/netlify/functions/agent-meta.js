'use strict';

/**
 * Netlify Function: agent-meta
 * Endpoint: /.netlify/functions/agent-meta
 * Self-contained — requires only registry.js directly.
 */

const { getAllAgents, getAgent, AGENTS } = require('../../agents/registry');

const DEPARTMENTS = {
  'Executive & Creative Leadership': [
    'executive-producer','showrunner','line-producer','creative-director',
    'production-manager','post-production-supervisor'
  ],
  'Vision & Story': [
    'vision-director','scene-architect','storyboard-artist','character-designer',
    'world-builder','logline-refiner','beat-sheet-architect','creative-prompt-writer',
    'research-specialist','tone-guardian','genre-interpreter','premise-expander'
  ],
  'Production': [
    'cinematographer','lighting-designer','movement-choreographer','dop-assistant',
    'location-scout','prop-master','wardrobe-coordinator','makeup-hair-specialist',
    'stunt-coordinator','practical-effects-supervisor','gaffer','key-grip',
    'crowd-coordinator','sound-recordist','stunt-performer-coordinator'
  ],
  'Post-Production & Editorial': [
    'head-editor','cut-specialist','montage-specialist','color-grading-agent',
    'music-sync-specialist','cross-fade-transition-artist','tempo-pacing-analyst',
    'dialogue-editor','sound-editor','final-cut-approver'
  ],
  'Sound & Audio': [
    'sound-design-lead','foley-artist','composer','ambient-sound-designer',
    'adr-specialist','mixer','sound-effects-librarian','emotional-audio-enhancer'
  ],
  'VFX': [
    'vfx-supervisor','vfx-compositor','vfx-artist','vfx-particle-specialist',
    'vfx-environment-artist','vfx-cgi-character-designer','vfx-motion-graphics-designer',
    'vfx-matte-painter','vfx-rotoscope-artist','vfx-tracking-matchmove-specialist',
    'vfx-lighting-integration-artist','vfx-simulation-artist','vfx-destruction-specialist',
    'vfx-weather-effects-artist','vfx-wire-removal-artist','vfx-final-deliverer'
  ],
  'Quality & Continuity': [
    'continuity-supervisor','emotional-truth-guardian','visual-consistency-guardian',
    'dramatic-logic-guardian','character-arc-guardian','timeline-consistency-checker',
    'wardrobe-prop-auditor','geography-set-guardian','performance-consistency-checker',
    'final-review-orchestrator'
  ],
  'Memory & Delivery': [
    'project-memory-keeper','character-bible-maintainer','reference-image-curator',
    'version-control-agent','feedback-integrator','export-delivery-specialist'
  ]
};

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
    const all = getAllAgents();

    const agents = all.map(a => ({
      id: a.id,
      name: a.name,
      max_tokens: a.max_tokens,
      temperature: a.temperature
    }));

    const byDepartment = {};
    for (const [dept, ids] of Object.entries(DEPARTMENTS)) {
      byDepartment[dept] = ids
        .filter(id => AGENTS[id])
        .map(id => ({
          id,
          name: AGENTS[id].name,
          max_tokens: AGENTS[id].max_tokens,
          temperature: AGENTS[id].temperature
        }));
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        agents,
        byDepartment,
        count: agents.length,
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
