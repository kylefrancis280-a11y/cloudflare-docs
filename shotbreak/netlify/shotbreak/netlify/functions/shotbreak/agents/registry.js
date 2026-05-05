'use strict';

const AGENTS = {

  'executive-producer': { id: 'executive-producer', name: 'Executive Producer', systemPrompt: `Final boss. Greenlight, kill, budget, vision.`, max_tokens: 1200, temperature: 0.7 },
  'creative-director': { id: 'creative-director', name: 'Creative Director', systemPrompt: `Ultimate artistic authority. God-tier taste.`, max_tokens: 1300, temperature: 0.8 },

  'head-editor': { id: 'head-editor', name: 'Head Editor', systemPrompt: `Supreme commander of editing. Oversees everything.`, max_tokens: 1500, temperature: 0.75 },
  'edit-workflow-manager': { id: 'edit-workflow-manager', name: 'Edit Workflow Manager', systemPrompt: `Coordinates the entire editing pipeline.`, max_tokens: 1100, temperature: 0.65 },
  'post-production-coordinator': { id: 'post-production-coordinator', name: 'Post-Production Coordinator', systemPrompt: `Oversees editing, color, sound, VFX.`, max_tokens: 1200, temperature: 0.7 },

  'assembly-editor': { id: 'assembly-editor', name: 'Assembly Editor', systemPrompt: `Builds first rough cut.`, max_tokens: 1300, temperature: 0.8 },
  'scene-editor': { id: 'scene-editor', name: 'Scene Editor', systemPrompt: `Fine-tunes scenes with surgical precision.`, max_tokens: 1300, temperature: 0.85 },
  'cut-specialist': { id: 'cut-specialist', name: 'Cut Specialist', systemPrompt: `Master of timing and rhythm.`, max_tokens: 1200, temperature: 0.9 },
  'music-sync-editor': { id: 'music-sync-editor', name: 'Music Sync Editor', systemPrompt: `Perfectly syncs music to picture.`, max_tokens: 1200, temperature: 0.9 },
  'colorist': { id: 'colorist', name: 'Colorist', systemPrompt: `World-class colorist.`, max_tokens: 1200, temperature: 0.85 },
  'vfx-compositor': { id: 'vfx-compositor', name: 'VFX Compositor', systemPrompt: `Seamlessly integrates visual effects.`, max_tokens: 1300, temperature: 0.85 },

  'vision-director': { id: 'vision-director', name: 'Vision Director', systemPrompt: `VISION-DIRECTOR — the most brilliant cinematic neo-noir genius alive.`, max_tokens: 1800, temperature: 0.9 },
};

module.exports = {
  getAgent: (id) => {
    const agent = AGENTS[id];
    if (!agent) throw new Error(`Unknown agent: ${id}`);
    return agent;
  },
  getAllAgents: () => Object.values(AGENTS)
};
