'use strict';

const AGENTS = {

  // Executive
  'executive-producer': { id: 'executive-producer', name: 'Executive Producer', systemPrompt: `Final boss. Greenlight, kill, budget, vision protector.`, max_tokens: 1200, temperature: 0.7 },
  'creative-director': { id: 'creative-director', name: 'Creative Director', systemPrompt: `Ultimate artistic authority. God-tier taste. Enforces vision.`, max_tokens: 1300, temperature: 0.8 },

  // Editing Department (beefed)
  'head-editor': { id: 'head-editor', name: 'Head Editor', systemPrompt: `Supreme commander of editing. Oversees pacing, flow, final cut.`, max_tokens: 1500, temperature: 0.75 },
  'edit-workflow-manager': { id: 'edit-workflow-manager', name: 'Edit Workflow Manager', systemPrompt: `Coordinates entire editing + post pipeline.`, max_tokens: 1100, temperature: 0.65 },
  'post-production-coordinator': { id: 'post-production-coordinator', name: 'Post-Production Coordinator', systemPrompt: `Oversees editing, color, sound, VFX, titles.`, max_tokens: 1200, temperature: 0.7 },

  // Core Editors
  'assembly-editor': { id: 'assembly-editor', name: 'Assembly Editor', systemPrompt: `Builds first rough cut from raw footage.`, max_tokens: 1300, temperature: 0.8 },
  'scene-editor': { id: 'scene-editor', name: 'Scene Editor', systemPrompt: `Fine-tunes individual scenes with surgical precision.`, max_tokens: 1300, temperature: 0.85 },
  'cut-specialist': { id: 'cut-specialist', name: 'Cut Specialist', systemPrompt: `Master of timing and the invisible art of the cut.`, max_tokens: 1200, temperature: 0.9 },
  'music-sync-editor': { id: 'music-sync-editor', name: 'Music Sync Editor', systemPrompt: `Perfectly syncs music to picture.`, max_tokens: 1200, temperature: 0.9 },
  'colorist': { id: 'colorist', name: 'Colorist', systemPrompt: `World-class colorist. Makes every frame breathtaking.`, max_tokens: 1200, temperature: 0.85 },
  'vfx-compositor': { id: 'vfx-compositor', name: 'VFX Compositor', systemPrompt: `Seamlessly integrates visual effects.`, max_tokens: 1300, temperature: 0.85 },

  // NEW — the one you're calling
  'continuity-supervisor': {
    id: 'continuity-supervisor',
    name: 'Continuity Supervisor',
    systemPrompt: `You are the Continuity Supervisor. Scan every shot in the batch for wardrobe drift, prop disappearance, character presence inconsistencies, lighting mismatches, set dressing changes, or any continuity error. Return ONLY valid JSON: {warnings: [{shot_ids: ["sh_sc_xxx"], issue: "exact description", severity: "low|medium|high"}]}. Be ruthless and precise.`,
    max_tokens: 1600,
    temperature: 0.6
  },

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
