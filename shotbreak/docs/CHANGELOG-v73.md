# v73 — Agent Apply System

Status: built on top of v72-SPEED. No backend changes. No new env vars. No new API cost.

## What changed

Every agent in the 50-agent crew can now write its output back into project state. Before v73, the "Run full crew" flow dumped ~12 agents' JSON outputs into `crew_analysis` as read-only `<details><pre>` blocks. Users could read them, but could not pull any of it into the project — Story Director's beat tags, Psychological Builder's core wounds, Weather Coordinator's per-scene weather, VFX Supervisor's flagged shots, Runtime Calculator's estimates, Set Dresser's location dressing — all advisory, none applied.

v73 makes every one of those outputs applyable with a click.

## User experience

After any "Run full crew" finishes (or on reload of a page where a crew has previously run):

1. A gold bar at the top shows: **"N suggested changes across M agents. Review each below, or apply everything at once."** with **`Apply all (N)`** and **`Expand all`** buttons.
2. Each agent is its own expandable card with a badge showing how many changes it wants to make (or "nothing to apply" if its output was purely advisory).
3. Expanding a card reveals a checkbox list of every individual change — e.g. *"SCENE 1 → inciting"*, *"JANE psychology (core_wound, external_desire)"*, *"INT. FOYER — description & anchors"*, *"sh_sc_001_01 — VFX (muzzle flash, medium)"*. Each row has a kind tag (set / merge / append / note).
4. User can uncheck any they don't want, then click **`Apply selected`**. The selected changes write directly onto `scene.beat_type`, `character.psychology`, `location.description`, `shot.vfx`, etc., and the page re-renders with the new state.
5. **`View raw output`** is still there for the curious.

The existing individual "Apply" buttons on script-doctor, character-sculptor, wardrobe-props, location-scout, cinematographer (coverage), prompt-smith, lighting-designer, and movement-choreographer still work exactly as before — left untouched.

## Files

### New

- **`agents/appliers.js`** (~900 lines) — `window.SB_Appliers` module. Registry of per-agent functions that map each agent's output JSON to concrete project-state mutations. Public API:

  ```js
  SB_Appliers.preview(agentId, output, project)
    // → { agent_id, label, count, changes: [{id, path, label, kind, before, after, ...}], no_changes }

  SB_Appliers.apply(agentId, output, project, selectedIds?)
    // → { applied, skipped, errors, changes }

  SB_Appliers.previewCrew(crewData, project)
    // → [{agent_id, count, changes, ...}, ...]

  SB_Appliers.applyCrew(crewData, project, selectedIds?)
    // → { applied, skipped, errors, per_agent }
  ```

  Change IDs are deterministic hashes of `path + kind + (scene_id|character|location|shot_id)`, so the UI's checkbox IDs round-trip cleanly through a re-preview inside `apply()`. Unknown agents fall back to a generic applier that saves output under `project.agent_notes[agentId]` — so *every* agent has some apply path, not just the ones I wrote explicit mappings for.

### Changed

- **`workflow/workflow.js`** — `renderCrewFromCache` and `runCrew`'s success-path rendering both now call a new shared `renderCrewResults()` / `renderAgentApplyCard()` that draws the Apply panels. `installCrewApplyHandlers()` (called once from `boot()`) installs delegated document-level click handlers for `[data-crew-apply-agent]`, `[data-crew-apply-step]`, `[data-crew-expand-all]`, `[data-crew-toggle-all]`, `[data-crew-show-raw]`. `bootWhenReady` now also waits for `window.SB_Appliers`.
- **`workflow/index.html`** — Added `<script src="/agents/appliers.js?v=73"></script>` before `workflow.js`; bumped all three agent/workflow script cache-busters from `?v=72` to `?v=73`. Added CSS for the new panel (`.crew-apply-all`, `.crew-apply-badge`, `.crew-change-row`, etc.) using the existing gold/cream palette.
- **`app.html`** — Bumped `agents/client.js` cache-buster to `?v=73` for consistency.

## Coverage by agent

Specific (hand-written) appliers for 48 of 50 agents. The remaining 2 have no applyable output by design (they're orchestration-only aliases in LEGACY_ALIASES). See `agents/appliers.js` for the full map. Highlights of where output lands:

| Agent | Writes to |
|---|---|
| vision-director | `project.vision.*` |
| story-director | `scene.beat_type`, `scene.beat_strength`, `project.story_doctor` |
| visual-director | `project.visual_grammar`, refines `project.vision.palette` |
| dialogue-writer | `character.voice_notes`, `project.dialogue_audit.top_rewrites` |
| action-writer | `scene.action_density`, `project.action_audit` |
| prompt-writer | `project.prompt_strategy` |
| visual-character-builder | `character.canonical_description`, `.visual_anchors`, `.consistency_phrase` |
| psychological-builder | `character.core_wound`, `.external_desire`, `.internal_desire`, `.obstacle`, `.arc_trajectory`, `.moral_flaw` |
| voice-builder | `character.voice_signature`, `.speech_patterns`, `.never_says`, `.regional_markers` |
| environment-builder | `location.description`, `.establishing_prompt`, `.sensory_anchors`, `.scale`, `.era`, `.materials` |
| atmospherics-builder | `scene.time_of_day`, `.weather`, `.lighting_plan`, `.sound_texture`, `.atmospherics` |
| dressing-builder | `location.set_dressing`, `scene.hand_props`, `project.vfx_plan.decisions` |
| timeline-editor | `project.timeline_plan` |
| pacing-editor | `project.pacing_plan`, `scene.pacing_note` |
| assembly-editor | `project.assembly_plan` |
| genre-specialist | `project.genre_tags` |
| beat-analyst | `scene.beat_type`, `.beat_strength`, `.beat_function` |
| continuity-supervisor | `project.continuity_flags[]` |
| cinematographer | *appends* to `project.shot_list` |
| movement-choreographer | `shot.cinematography.movement` |
| color-theorist | `scene.color_palette`, refines `project.vision.palette.rationale` |
| colorist | `project.color_grade` |
| dialogue-coach | `character.dialogue_rewrites`, `project.dialogue_audit.coach_rewrites` |
| cliche-detector | `project.cliche_flags[]` |
| script-doctor | `scene.raw` (scene rewrite) |
| script-formatter | `project.format_issues[]` |
| subtext-writer | `scene.subtext`, `.subtextual_intent`, `.character_undertones` |
| prompt-smith | `shot.final_prompt`, `.negative_prompt`, `.model_target`, shot brief fields |
| scene-architect | `scene.scene_structure`, `.stakes`, `.scene_turn` |
| shot-calibrator | `shot.model_variants` (kling/veo/hailuo/seedance variants) |
| character-sculptor | `character.canonical_description`, `.visual_anchors` |
| wardrobe-props | `character.wardrobe_default`, `.signature_props`, `.period_notes` |
| emotion-mapper | `scene.emotion_map`, `.emotion_arc` |
| voice-consistency-auditor | `project.voice_consistency_flags[]` |
| adr-supervisor | `project.adr_notes[]` |
| location-scout | `location.description`, `.establishing_prompt`, `.sensory_anchors` |
| architecture-designer | `location.building_type`, `.era`, `.materials`, `.architectural_signature` |
| lighting-designer | `scene.lighting_plan.{key_light,fill_light,rim_light,motivated_source,mood_note}` |
| weather-coordinator | `scene.time_of_day`, `.weather`, `.air_quality`, `.temperature_feel` |
| sound-designer | `scene.sound_design`, `.ambience`, `.score_note` |
| props-master | `scene.hero_props`, `.signature_props`, `.active_props` |
| set-dresser | `location.wall_dressing`, `.surface_dressing`, `.worldbuilding_hooks` |
| vfx-supervisor | `shot.vfx`, `project.vfx_plan.summary` |
| editor | `project.edit_notes` |
| transition-designer | `project.transitions[]` |
| pacing-doctor | `scene.pacing_issue`, `.pacing_fix`, `.tempo` |
| runtime-calculator | `scene.estimated_runtime_seconds`, `project.runtime_estimate` |
| trailer-cutter | `project.trailer_cut` |
| polish-pass | `project.polish_notes[]`, `.polish_summary` |
| music-supervisor | `project.music_cues[]` |

## Tests

Built a 12-case Node smoke test against realistic project fixtures — covering preview, apply, selective apply via `selectedIds`, scene lookup by `sc_001` / slug / `"scene 2"`, per-character / per-location / per-shot writes, append-mode shot creation, crew-wide apply, idempotency on re-apply, and graceful handling of empty/malformed output. All 12 pass. Two bugs found during testing and fixed before release:

1. `mkChange` wasn't destructuring `_apply`, so every `_apply` closure was being silently replaced with `null` and `apply()` was a no-op. Fixed.
2. No-op filter was strict `deepEqual(before, after)`, which incorrectly flagged merge-mode changes as real when `before` had unrelated extra fields. Added `isNoOp()` that understands merge semantics. Fixed.

## Known edge cases

- **Shape drift.** Agents return real JSON shapes that may differ from my schema assumptions when output tokens get truncated or the model improvises. The appliers are tolerant (multiple fallback key names per field, `isPresent()` guards, no crashes on missing keys), but if an agent's real output shape drifts hard from what I expect, changes will silently get 0-count. Worst case: user sees "nothing to apply" and can still view raw output — never a crash.
- **Legacy fields preserved.** Wardrobe/props writes both `signature_props` (new) and `props` (legacy) for backward compat with anything still reading the old field.
- **Append mode is additive only.** Cinematographer "additional shots" always appends — never replaces. The existing coverage-scene flow already handles full replacement.
- **No destructive confirmations for single-agent apply.** The `Apply all` button asks `confirm()` because it's a bulk op. Per-agent `Apply selected` doesn't — the user already chose their rows.
