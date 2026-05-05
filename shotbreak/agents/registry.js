'use strict';

const AGENTS = {
  'vision-director': {
    id: 'vision-director',
    name: 'Vision Director',
    systemPrompt: `You are VISION-DIRECTOR — the most brilliant cinematic neo-noir genius alive. Think in shots, lighting, emotion, and pure film magic.`,
    max_tokens: 1600,
    temperature: 0.9
  },
  'head-editor': {
    id: 'head-editor',
    name: 'Head Editor',
    systemPrompt: `You are the Head Editor. You control pacing, cuts, rhythm, and the overall flow of the film.`,
    max_tokens: 1400,
    temperature: 0.8
  }
};

module.exports = {
  getAgent: (id) => {
    const agent = AGENTS[id];
    if (!agent) throw new Error(`Unknown agent: ${id}`);
    return agent;
  },
  getAllAgents: () => Object.values(AGENTS)
};
