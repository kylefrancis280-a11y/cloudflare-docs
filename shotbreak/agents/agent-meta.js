'use strict';

/**
 * agent-meta.js
 * Provides metadata for all 82 Shotbreak agents sourced from registry.js.
 * Used by the frontend to populate agent selectors, tooltips, and capability maps.
 */

const { getAllAgents, getAgent, AGENTS } = require('./registry');

// ─── Full agent list with metadata ───────────────────────────────────────────

/**
 * Returns lightweight metadata for all agents (no systemPrompt).
 * Safe to expose to the frontend.
 */
function getAgentMeta() {
  return getAllAgents().map(agent => ({
    id: agent.id,
    name: agent.name,
    max_tokens: agent.max_tokens,
    temperature: agent.temperature
  }));
}

/**
 * Returns full agent data including systemPrompt for a single agent.
 * Used server-side only.
 */
function getAgentFull(id) {
  return getAgent(id) || null;
}

/**
 * Returns count of registered agents.
 */
function getAgentCount() {
  return Object.keys(AGENTS).length;
}

/**
 * Returns all agent IDs.
 */
function getAgentIds() {
  return Object.keys(AGENTS);
}

/**
 * Validates that an agent ID exists in the registry.
 */
function isValidAgent(id) {
  return Boolean(AGENTS[id]);
}

/**
 * Groups agents by department for UI rendering.
 */
function getAgentsByDepartment() {
  const departments = {
    'Executive & Creative Leadership': [
      'executive-producer', 'showrunner', 'line-producer', 'creative-director',
      'production-manager', 'post-production-supervisor'
    ],
    'Vision & Story': [
      'vision-director', 'scene-architect', 'storyboard-artist', 'character-designer',
      'world-builder', 'logline-refiner', 'beat-sheet-architect', 'creative-prompt-writer',
      'research-specialist', 'tone-guardian', 'genre-interpreter', 'premise-expander'
    ],
    'Production': [
      'cinematographer', 'lighting-designer', 'movement-choreographer', 'dop-assistant',
      'location-scout', 'prop-master', 'wardrobe-coordinator', 'makeup-hair-specialist',
      'stunt-coordinator', 'practical-effects-supervisor', 'gaffer', 'key-grip',
      'crowd-coordinator', 'sound-recordist', 'stunt-performer-coordinator'
    ],
    'Post-Production & Editorial': [
      'head-editor', 'cut-specialist', 'montage-specialist', 'color-grading-agent',
      'music-sync-specialist', 'cross-fade-transition-artist', 'tempo-pacing-analyst',
      'dialogue-editor', 'sound-editor', 'final-cut-approver'
    ],
    'Sound & Audio': [
      'sound-design-lead', 'foley-artist', 'composer', 'ambient-sound-designer',
      'adr-specialist', 'mixer', 'sound-effects-librarian', 'emotional-audio-enhancer'
    ],
    'VFX': [
      'vfx-supervisor', 'vfx-compositor', 'vfx-artist', 'vfx-particle-specialist',
      'vfx-environment-artist', 'vfx-cgi-character-designer', 'vfx-motion-graphics-designer',
      'vfx-matte-painter', 'vfx-rotoscope-artist', 'vfx-tracking-matchmove-specialist',
      'vfx-lighting-integration-artist', 'vfx-simulation-artist', 'vfx-destruction-specialist',
      'vfx-weather-effects-artist', 'vfx-wire-removal-artist', 'vfx-final-deliverer'
    ],
    'Quality & Continuity': [
      'continuity-supervisor', 'emotional-truth-guardian', 'visual-consistency-guardian',
      'dramatic-logic-guardian', 'character-arc-guardian', 'timeline-consistency-checker',
      'wardrobe-prop-auditor', 'geography-set-guardian', 'performance-consistency-checker',
      'final-review-orchestrator'
    ],
    'Memory & Delivery': [
      'project-memory-keeper', 'character-bible-maintainer', 'reference-image-curator',
      'version-control-agent', 'feedback-integrator', 'export-delivery-specialist'
    ]
  };

  const result = {};
  for (const [dept, ids] of Object.entries(departments)) {
    result[dept] = ids
      .filter(id => AGENTS[id])
      .map(id => ({
        id,
        name: AGENTS[id].name,
        max_tokens: AGENTS[id].max_tokens,
        temperature: AGENTS[id].temperature
      }));
  }
  return result;
}

module.exports = {
  getAgentMeta,
  getAgentFull,
  getAgentCount,
  getAgentIds,
  isValidAgent,
  getAgentsByDepartment
};
