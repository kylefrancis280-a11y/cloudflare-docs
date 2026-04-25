// ═══════════════════════════════════════════════════════════════════════════
//  SHOTBREAK — Agent Output → Project State Appliers
//  ──────────────────────────────────────────────────────────────────────────
//  For every agent in the 50-agent crew, defines HOW its JSON output maps back
//  onto the project. Exposes window.SB_Appliers with:
//
//    preview(agentId, output, project)  → { title, summary, changes: [...] }
//    apply(agentId, output, project, selectedChanges?) → { applied, skipped, errors }
//
//  Each "change" is { id, path, label, kind, before, after, enabled }.
//  UI renders a checklist of changes; user can uncheck any before applying.
//
//  Design rules:
//    • Never throw. Missing fields → skipped change, not an error.
//    • Project is mutated directly. Caller persists via saveProject().
//    • Unknown agents fall back to a generic "save as notes" applier so
//      every single one of the 50 agents has SOME apply path.
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // Legacy aliases — must match client.js
  const LEGACY_ALIASES = { auteur: 'vision-director', showrunner: 'assembly-editor' };
  const resolveId = (id) => LEGACY_ALIASES[id] || id;

  // ─── Utilities ──────────────────────────────────────────────────────────

  // Change IDs are deterministic — hash of path + kind. This way the UI can
  // collect checkbox IDs from one preview() call, pass them to apply() which
  // internally re-previews, and the IDs still match. Without this the user's
  // selections silently don't round-trip.
  function stableId(path, kind, extraKey) {
    const src = `${kind}|${path}|${extraKey || ''}`;
    let h = 5381;
    for (let i = 0; i < src.length; i++) h = ((h * 33) ^ src.charCodeAt(i)) >>> 0;
    return 'chg_' + h.toString(36);
  }

  function isPresent(v) {
    if (v == null) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.keys(v).length > 0;
    return true;
  }

  function deepEqual(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ak = Object.keys(a), bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) if (!deepEqual(a[k], b[k])) return false;
    return true;
  }

  function pickDefined(obj, keys) {
    const out = {};
    for (const k of keys) if (isPresent(obj?.[k])) out[k] = obj[k];
    return out;
  }

  function truncate(v, n) {
    const s = typeof v === 'string' ? v : (v == null ? '' : JSON.stringify(v));
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function summarizeValue(v) {
    if (v == null || v === '') return '—';
    if (typeof v === 'string') return truncate(v, 90);
    if (Array.isArray(v)) return v.length + (v.length === 1 ? ' item' : ' items');
    if (typeof v === 'object') return Object.keys(v).length + ' fields';
    return String(v);
  }

  // Find helpers — tolerant matchers against project state
  function findSceneByRef(project, ref) {
    const scenes = project?.script?.normalized?.scenes || [];
    if (!ref) return null;
    const s = String(ref).trim();
    // Match by id first (sc_001), then slug, then 1-based index
    let scene = scenes.find(x => x.id === s);
    if (scene) return scene;
    scene = scenes.find(x => x.slug === s);
    if (scene) return scene;
    const lower = s.toLowerCase();
    scene = scenes.find(x => (x.slug || '').toLowerCase() === lower);
    if (scene) return scene;
    // Loose match: "scene 3" → index 2
    const m = /^scene\s*(\d+)$/i.exec(s);
    if (m) return scenes[parseInt(m[1], 10) - 1] || null;
    // Fallback: if ref is "sc_3" style
    const m2 = /^sc_?(\d+)$/i.exec(s);
    if (m2) return scenes[parseInt(m2[1], 10) - 1] || null;
    return null;
  }

  function findCharacter(project, name) {
    if (!name) return null;
    const bible = project?.character_bible || {};
    if (bible[name]) return { name, data: bible[name] };
    // Case-insensitive
    const found = Object.keys(bible).find(k => k.toLowerCase() === String(name).toLowerCase());
    return found ? { name: found, data: bible[found] } : null;
  }

  function findLocation(project, name) {
    if (!name) return null;
    const lib = project?.location_library || {};
    if (lib[name]) return { name, data: lib[name] };
    const found = Object.keys(lib).find(k => k.toLowerCase() === String(name).toLowerCase());
    return found ? { name: found, data: lib[found] } : null;
  }

  function findShot(project, shotId) {
    return (project?.shot_list || []).find(s => s.id === shotId) || null;
  }

  // Change constructor — always returns a consistent shape. ID is stable
  // (derived from path + kind + optional meta) so re-previewing produces
  // the same IDs that the UI checkbox list rendered with.
  function mkChange({ path, label, kind, before, after, sceneSlug, targetName, meta, _apply }) {
    kind = kind || 'set';
    // Include a stable discriminator from meta when available (scene_id,
    // character, location, shot_id) so per-item changes under the same path
    // category get distinct IDs.
    const metaKey = meta && (meta.scene_id || meta.character || meta.location || meta.shot_id || '');
    return {
      id: stableId(path, kind, metaKey),
      path,
      label,
      kind,
      before: before ?? null,
      after:  after ?? null,
      sceneSlug: sceneSlug || null,
      targetName: targetName || null,
      meta: meta || null,
      enabled: true,
      _apply: _apply || null,
    };
  }

  // Would applying this change actually modify the project? For 'set' kind,
  // strict equality of before/after. For 'merge', check every key in after
  // already matches the before value exactly. For 'append', always a change
  // (new items). For 'note'/'flag', compare JSON.
  function isNoOp(chg) {
    if (!chg) return true;
    if (chg.kind === 'append') return false;
    if (chg.kind === 'merge' && chg.before && chg.after && typeof chg.after === 'object' && !Array.isArray(chg.after)) {
      for (const [k, v] of Object.entries(chg.after)) {
        if (!deepEqual(chg.before[k], v)) return false;
      }
      return true;
    }
    return deepEqual(chg.before, chg.after);
  }

  // Helper: write a value to an arbitrary dotted path on the project. Creates
  // intermediate objects as needed. Only used for top-level + simple nested
  // writes where custom logic isn't needed.
  function writePath(project, dotted, value) {
    const parts = dotted.split('.');
    let obj = project;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (obj[k] == null || typeof obj[k] !== 'object') obj[k] = {};
      obj = obj[k];
    }
    obj[parts[parts.length - 1]] = value;
  }

  function readPath(project, dotted) {
    const parts = dotted.split('.');
    let obj = project;
    for (const k of parts) {
      if (obj == null) return undefined;
      obj = obj[k];
    }
    return obj;
  }

  // ─── Shared change builders (reusable across many agents) ────────────────

  // Write selected top-level vision fields to p.vision
  function visionFieldsChange(out, p, fields, label) {
    const picks = pickDefined(out, fields);
    if (!isPresent(picks)) return null;
    return mkChange({
      path: 'vision',
      label,
      kind: 'merge',
      before: pickDefined(p.vision || {}, fields),
      after: picks,
      meta: { fields: Object.keys(picks) },
      _apply: (proj) => {
        proj.vision = proj.vision || {};
        Object.assign(proj.vision, picks);
      }
    });
  }

  // Per-scene field writes. `items` = output array with scene refs.
  // `fieldMap` = { outputKey: sceneFieldName }
  function perSceneFieldChanges(items, p, fieldMap, labelFormatter) {
    const out = [];
    if (!Array.isArray(items)) return out;
    items.forEach((item) => {
      if (!item) return;
      const ref = item.scene_id || item.id || item.scene || item.slug;
      const scene = findSceneByRef(p, ref);
      if (!scene) return;
      const picks = {};
      for (const [outKey, sceneKey] of Object.entries(fieldMap)) {
        if (isPresent(item[outKey])) picks[sceneKey] = item[outKey];
      }
      if (!isPresent(picks)) return;
      out.push(mkChange({
        path: `scene.${scene.id}`,
        label: labelFormatter ? labelFormatter(scene, picks, item) : `${scene.slug}: ${Object.keys(picks).join(', ')}`,
        kind: 'merge',
        before: pickDefined(scene, Object.values(fieldMap)),
        after: picks,
        sceneSlug: scene.slug,
        meta: { scene_id: scene.id, fields: Object.keys(picks) },
        _apply: (proj) => {
          const s = findSceneByRef(proj, scene.id);
          if (s) Object.assign(s, picks);
        }
      }));
    });
    return out;
  }

  // Per-character field writes. `items` = output array with character refs.
  function perCharacterFieldChanges(items, p, fieldMap, labelFormatter) {
    const out = [];
    if (!Array.isArray(items)) return out;
    items.forEach((item) => {
      if (!item) return;
      const name = item.character || item.name || item.character_name;
      const match = findCharacter(p, name);
      if (!match) return;
      const picks = {};
      for (const [outKey, charKey] of Object.entries(fieldMap)) {
        if (isPresent(item[outKey])) picks[charKey] = item[outKey];
      }
      if (!isPresent(picks)) return;
      out.push(mkChange({
        path: `character.${match.name}`,
        label: labelFormatter ? labelFormatter(match, picks, item) : `${match.name}: ${Object.keys(picks).join(', ')}`,
        kind: 'merge',
        before: pickDefined(match.data, Object.values(fieldMap)),
        after: picks,
        targetName: match.name,
        meta: { character: match.name, fields: Object.keys(picks) },
        _apply: (proj) => {
          const c = proj.character_bible?.[match.name];
          if (c) Object.assign(c, picks);
        }
      }));
    });
    return out;
  }

  // Per-location field writes
  function perLocationFieldChanges(items, p, fieldMap, labelFormatter) {
    const out = [];
    if (!Array.isArray(items)) return out;
    items.forEach((item) => {
      if (!item) return;
      const name = item.location || item.name || item.location_name;
      const match = findLocation(p, name);
      if (!match) return;
      const picks = {};
      for (const [outKey, locKey] of Object.entries(fieldMap)) {
        if (isPresent(item[outKey])) picks[locKey] = item[outKey];
      }
      if (!isPresent(picks)) return;
      out.push(mkChange({
        path: `location.${match.name}`,
        label: labelFormatter ? labelFormatter(match, picks, item) : `${match.name}: ${Object.keys(picks).join(', ')}`,
        kind: 'merge',
        before: pickDefined(match.data, Object.values(fieldMap)),
        after: picks,
        targetName: match.name,
        meta: { location: match.name, fields: Object.keys(picks) },
        _apply: (proj) => {
          const l = proj.location_library?.[match.name];
          if (l) Object.assign(l, picks);
        }
      }));
    });
    return out;
  }

  // Per-shot field writes
  function perShotFieldChanges(items, p, fieldMap, labelFormatter) {
    const out = [];
    if (!Array.isArray(items)) return out;
    items.forEach((item) => {
      if (!item) return;
      const shotId = item.shot_id || item.id;
      const shot = findShot(p, shotId);
      if (!shot) return;
      const picks = {};
      for (const [outKey, shotKey] of Object.entries(fieldMap)) {
        if (isPresent(item[outKey])) picks[shotKey] = item[outKey];
      }
      if (!isPresent(picks)) return;
      out.push(mkChange({
        path: `shot.${shot.id}`,
        label: labelFormatter ? labelFormatter(shot, picks, item) : `${shot.slot || shot.id}: ${Object.keys(picks).join(', ')}`,
        kind: 'merge',
        before: pickDefined(shot, Object.values(fieldMap)),
        after: picks,
        meta: { shot_id: shot.id, fields: Object.keys(picks) },
        _apply: (proj) => {
          const s = findShot(proj, shot.id);
          if (s) Object.assign(s, picks);
        }
      }));
    });
    return out;
  }

  // Top-level merge into a project-scoped annotation (e.g. p.story_doctor)
  function topLevelAnnotation(key, label, valueBuilder) {
    return (out, p) => {
      const value = valueBuilder(out, p);
      if (!isPresent(value)) return null;
      return mkChange({
        path: key,
        label,
        kind: 'merge',
        before: p[key] || null,
        after: value,
        meta: { top_level: key },
        _apply: (proj) => {
          proj[key] = { ...(proj[key] || {}), ...value, updated_at: Date.now() };
        }
      });
    };
  }

  // ─── Registry ───────────────────────────────────────────────────────────
  //
  // Each entry: { preview(out, p) -> changes[], label? }
  // Changes each include their own `_apply(project)` closure — apply() just
  // calls those in order. This keeps logic for each change co-located.

  const APPLIERS = {};

  // ────────── TIER 1 MANAGERS ──────────

  APPLIERS['vision-director'] = {
    label: 'Vision',
    preview(out, p) {
      const changes = [];
      const c = visionFieldsChange(out, p, [
        'logline', 'vision_statement', 'tonal_anchors', 'palette', 'lens_language',
        'pacing_contract', 'genre_interpretation', 'continuity_rules',
        'reference_synthesis', 'handoff_to_downstream'
      ], 'Set / update full vision document');
      if (c) changes.push(c);
      return changes;
    }
  };

  APPLIERS['story-director'] = {
    label: 'Story structure',
    preview(out, p) {
      const changes = [];

      // Per-scene beat tagging — real schema is core_beats[] where each item
      // has scene_ids[]. Convert the inverted shape (beat→scenes) into per-
      // scene writes (scene→beat).
      const beatTags = {};  // sceneId → {beat_type, beat_strength}
      (out.core_beats || []).forEach(b => {
        (b.scene_ids || []).forEach(sid => {
          if (!beatTags[sid]) beatTags[sid] = {};
          if (b.beat) beatTags[sid].beat_type = b.beat;
          if (b.strength) beatTags[sid].beat_strength = b.strength;
          if (b.description) beatTags[sid].beat_notes = b.description;
        });
      });
      Object.entries(beatTags).forEach(([sid, picks]) => {
        const scene = findSceneByRef(p, sid);
        if (!scene) return;
        const before = pickDefined(scene, ['beat_type','beat_strength','beat_notes']);
        if (deepEqual(before, picks)) return;
        changes.push(mkChange({
          path: `scene.${scene.id}`,
          label: `${scene.slug} → ${picks.beat_type || 'beat'}${picks.beat_strength ? ' (' + picks.beat_strength + ')' : ''}`,
          kind: 'merge',
          before,
          after: picks,
          sceneSlug: scene.slug,
          meta: { scene_id: scene.id, fields: Object.keys(picks) },
          _apply: (proj) => {
            const s = findSceneByRef(proj, scene.id);
            if (s) Object.assign(s, picks);
          }
        }));
      });

      // Top-level structural diagnosis — real schema uses structure_verdict
      // (not 'verdict') and structure_notes (not free-form text).
      const annot = pickDefined(out, [
        'structure_verdict', 'structure_notes', 'missing_beats',
        'cause_and_effect_gaps', 'arc_integrity'
      ]);
      if (isPresent(annot)) {
        changes.push(mkChange({
          path: 'story_doctor',
          label: `Story diagnosis${annot.structure_verdict ? ' — ' + annot.structure_verdict : ''}`,
          kind: 'merge',
          before: p.story_doctor || null,
          after: annot,
          meta: {
            verdict: annot.structure_verdict,
            gap_count: (annot.cause_and_effect_gaps || []).length,
            missing_count: (annot.missing_beats || []).length,
          },
          _apply: (proj) => {
            proj.story_doctor = { ...(proj.story_doctor || {}), ...annot, updated_at: Date.now() };
          }
        }));
      }
      return changes;
    }
  };

  APPLIERS['visual-director'] = {
    label: 'Visual grammar',
    preview(out, p) {
      const changes = [];

      // Real schema: visual_grammar is a NESTED object with
      // dominant_lens_range, framing_principle, movement_philosophy,
      // composition_rules — not flat fields.
      if (isPresent(out.visual_grammar)) {
        changes.push(mkChange({
          path: 'visual_grammar',
          label: 'Lock visual grammar (lens range, framing, movement, rules)',
          kind: 'merge',
          before: p.visual_grammar || null,
          after: out.visual_grammar,
          meta: { fields: Object.keys(out.visual_grammar) },
          _apply: (proj) => { proj.visual_grammar = { ...(proj.visual_grammar || {}), ...out.visual_grammar, updated_at: Date.now() }; }
        }));
      }

      // palette_application — master_palette + palette_logic + per_scene_shifts
      if (isPresent(out.palette_application)) {
        const pa = out.palette_application;
        // Top-level palette → vision.palette
        if (isPresent(pa.master_palette) || isPresent(pa.palette_logic)) {
          const paletteUpdate = {};
          if (pa.master_palette) paletteUpdate.master = pa.master_palette;
          if (pa.palette_logic) paletteUpdate.rationale = pa.palette_logic;
          changes.push(mkChange({
            path: 'vision.palette',
            label: 'Refine master palette + emotional logic',
            kind: 'merge',
            before: pickDefined(p.vision?.palette || {}, ['master','rationale']),
            after: paletteUpdate,
            _apply: (proj) => {
              proj.vision = proj.vision || {};
              proj.vision.palette = { ...(proj.vision.palette || {}), ...paletteUpdate };
            }
          }));
        }
        // Per-scene palette shifts
        if (Array.isArray(pa.per_scene_shifts) && pa.per_scene_shifts.length) {
          changes.push(...perSceneFieldChanges(pa.per_scene_shifts, p, {
            palette_note: 'palette_note',
          }, (scene, picks) => `${scene.slug} — palette shift`));
        }
      }

      // Signature shots & reference films → top-level reference points
      const refs = pickDefined(out, ['signature_shots', 'reference_films']);
      if (isPresent(refs)) {
        changes.push(mkChange({
          path: 'visual_references',
          label: `Save ${refs.signature_shots ? refs.signature_shots.length + ' signature shots' : ''}${refs.signature_shots && refs.reference_films ? ' + ' : ''}${refs.reference_films ? refs.reference_films.length + ' reference films' : ''}`,
          kind: 'merge',
          before: p.visual_references || null,
          after: refs,
          _apply: (proj) => { proj.visual_references = { ...(proj.visual_references || {}), ...refs, updated_at: Date.now() }; }
        }));
      }
      return changes;
    }
  };

  APPLIERS['dialogue-writer'] = {
    label: 'Dialogue audit',
    preview(out, p) {
      const changes = [];

      // Per-character voice notes — real schema is per_character_notes[]
      // with character/voice_signature/distinctness_score/issues fields.
      const charNotes = (out.per_character_notes || []).map(item => ({
        character: item.character,
        voice_signature: item.voice_signature,
        voice_distinctness_score: item.distinctness_score,
        voice_issues: item.issues,
      }));
      changes.push(...perCharacterFieldChanges(charNotes, p, {
        voice_signature: 'voice_signature',
        voice_distinctness_score: 'voice_distinctness_score',
        voice_issues: 'voice_issues',
      }, (m, picks) => `${m.name}: voice signature${picks.voice_distinctness_score != null ? ' (score ' + picks.voice_distinctness_score + ')' : ''}`));

      // Top rewrites with full provenance
      const rewrites = out.top_rewrites || [];
      if (Array.isArray(rewrites) && rewrites.length) {
        changes.push(mkChange({
          path: 'dialogue_audit.top_rewrites',
          label: `${rewrites.length} suggested line rewrite${rewrites.length === 1 ? '' : 's'}`,
          kind: 'set',
          before: p.dialogue_audit?.top_rewrites || null,
          after: rewrites,
          meta: { count: rewrites.length },
          _apply: (proj) => {
            proj.dialogue_audit = proj.dialogue_audit || {};
            proj.dialogue_audit.top_rewrites = rewrites;
            proj.dialogue_audit.updated_at = Date.now();
          }
        }));
      }

      // Top-level verdict + scores
      const verdictFields = pickDefined(out, [
        'dialogue_verdict', 'voice_distinctness_score',
        'cliche_density', 'subtext_balance'
      ]);
      if (isPresent(verdictFields)) {
        changes.push(mkChange({
          path: 'dialogue_audit',
          label: `Dialogue verdict${out.dialogue_verdict ? ' — ' + out.dialogue_verdict : ''}`,
          kind: 'merge',
          before: pickDefined(p.dialogue_audit || {}, Object.keys(verdictFields)),
          after: verdictFields,
          _apply: (proj) => {
            proj.dialogue_audit = { ...(proj.dialogue_audit || {}), ...verdictFields, updated_at: Date.now() };
          }
        }));
      }
      return changes;
    }
  };

  APPLIERS['action-writer'] = {
    label: 'Action-line audit',
    preview(out, p) {
      const changes = [];
      changes.push(...perSceneFieldChanges(out.per_scene || out.scenes || [], p, {
        action_density: 'action_density',
        action_issues:  'action_issues',
        subtext_layer:  'subtext_layer',
      }));
      const top = topLevelAnnotation('action_audit', 'Action audit summary', (o) => pickDefined(o, [
        'verdict', 'density_verdict', 'format_issues', 'strongest_scenes', 'weakest_scenes'
      ]))(out, p);
      if (top) changes.push(top);
      return changes;
    }
  };

  APPLIERS['prompt-writer'] = {
    label: 'Prompt strategy',
    preview(out, p) {
      // Schema actually emitted by the agent (registry line 358):
      //   prompt_strategy (string), model_allocation (object),
      //   target_model_default, per_model_usage_notes, global_negative_prompt,
      //   character_reference_policy, upstream_context_checklist,
      //   instructions_to_specialists
      // Note: NOT 'strategy' / 'motion_strategy' / 'duration_policy' / etc —
      // those were a hallucinated v73 schema. v83 fixes the field names.
      const ps = pickDefined(out, [
        'prompt_strategy', 'model_allocation', 'target_model_default',
        'per_model_usage_notes', 'global_negative_prompt',
        'character_reference_policy', 'upstream_context_checklist',
        'instructions_to_specialists'
      ]);
      if (!isPresent(ps)) return [];
      return [mkChange({
        path: 'prompt_strategy',
        label: `Lock prompt strategy${ps.target_model_default ? ' (default: ' + ps.target_model_default + ')' : ''}`,
        kind: 'merge',
        before: p.prompt_strategy || null,
        after: ps,
        meta: { fields: Object.keys(ps) },
        _apply: (proj) => { proj.prompt_strategy = { ...(proj.prompt_strategy || {}), ...ps, updated_at: Date.now() }; }
      })];
    }
  };

  APPLIERS['visual-character-builder'] = {
    label: 'Character bible',
    preview(out, p) {
      const changes = [];
      // Real schema (registry line 418): character_bible[] with name,
      // canonical_description, consistency_phrase, visual_anchors,
      // wardrobe_default, signature_props, scene_overrides,
      // visual_consistency_rules, reference_image_required.
      const chars = out.character_bible || out.characters || out.per_character || [];
      chars.forEach((c) => {
        if (!c) return;
        const name = c.name || c.character_name;
        const match = findCharacter(p, name);
        if (!match) return;
        const picks = pickDefined(c, [
          'canonical_description', 'consistency_phrase', 'visual_anchors',
          'wardrobe_default', 'signature_props', 'scene_overrides',
          'visual_consistency_rules', 'reference_image_required'
        ]);
        if (!isPresent(picks)) return;
        changes.push(mkChange({
          path: `character.${match.name}`,
          label: `${match.name} — ${Object.keys(picks).length} visual fields`,
          kind: 'merge',
          before: pickDefined(match.data, Object.keys(picks)),
          after: picks,
          targetName: match.name,
          meta: { character: match.name },
          _apply: (proj) => {
            const cc = proj.character_bible?.[match.name];
            if (cc) Object.assign(cc, picks);
          }
        }));
      });
      // Project-level consistency risk
      const riskFields = pickDefined(out, ['consistency_risk_assessment', 'risk_mitigation']);
      if (isPresent(riskFields)) {
        changes.push(mkChange({
          path: 'character_consistency_risk',
          label: `Consistency risk: ${riskFields.consistency_risk_assessment || 'flagged'}`,
          kind: 'merge',
          before: p.character_consistency_risk || null,
          after: riskFields,
          _apply: (proj) => { proj.character_consistency_risk = { ...(proj.character_consistency_risk || {}), ...riskFields, updated_at: Date.now() }; }
        }));
      }
      return changes;
    }
  };

  APPLIERS['psychological-builder'] = {
    label: 'Character psychology',
    preview(out, p) {
      // Real schema (line 496): character_psychology[] with name,
      // core_wound, external_desire, internal_desire, obstacle,
      // arc_trajectory, moral_flaw, psychological_signature.
      const items = out.character_psychology || out.psychology || out.per_character || out.characters || [];
      const changes = perCharacterFieldChanges(items.map(x => ({
        ...x,
        character: x.character || x.name || x.character_name,
      })), p, {
        core_wound:              'core_wound',
        external_desire:         'external_desire',
        internal_desire:         'internal_desire',
        obstacle:                'obstacle',
        arc_trajectory:          'arc_trajectory',
        moral_flaw:              'moral_flaw',
        psychological_signature: 'psychological_signature',
      }, (m, picks) => `${m.name} — psychology (${Object.keys(picks).length} fields)`);

      if (out.congruence_check) {
        changes.push(mkChange({
          path: 'psychology_congruence',
          label: 'Save psychology congruence note',
          kind: 'set',
          before: p.psychology_congruence || null,
          after: out.congruence_check,
          _apply: (proj) => { proj.psychology_congruence = out.congruence_check; }
        }));
      }
      return changes;
    }
  };

  APPLIERS['voice-builder'] = {
    label: 'Voice signatures',
    preview(out, p) {
      // Real schema (line 570-579): voice_signatures[] with name,
      // vocabulary_register, sentence_length, contractions,
      // regional_marker, signature_patterns, never_says,
      // defining_line_sample.
      const items = out.voice_signatures || out.per_character || out.characters || [];
      const changes = perCharacterFieldChanges(items.map(x => ({
        ...x,
        character: x.character || x.name || x.character_name,
      })), p, {
        vocabulary_register:    'vocabulary_register',
        sentence_length:        'sentence_length',
        contractions:           'contractions',
        regional_marker:        'regional_marker',
        signature_patterns:     'signature_patterns',
        never_says:             'never_says',
        defining_line_sample:   'defining_line_sample',
      }, (m) => `${m.name} — voice signature (6 dimensions)`);

      if (out.distinctness_audit) {
        changes.push(mkChange({
          path: 'voice_distinctness_audit',
          label: 'Save voice distinctness audit',
          kind: 'set',
          before: p.voice_distinctness_audit || null,
          after: out.distinctness_audit,
          _apply: (proj) => { proj.voice_distinctness_audit = out.distinctness_audit; }
        }));
      }
      return changes;
    }
  };

  APPLIERS['environment-builder'] = {
    label: 'Location library',
    preview(out, p) {
      const changes = [];
      // Real schema (line 641): location_library[] with name, scale,
      // architecture_style, era, materials, weathering_level,
      // geographic_context, paragraph_description, establishing_prompt,
      // sensory_anchors.
      const items = out.location_library || out.locations || out.per_location || [];
      items.forEach((l) => {
        if (!l) return;
        const name = l.name || l.location_name || l.location;
        const match = findLocation(p, name);
        if (!match) return;
        const raw = pickDefined(l, [
          'scale', 'architecture_style', 'era', 'materials', 'weathering_level',
          'geographic_context', 'paragraph_description', 'establishing_prompt',
          'sensory_anchors'
        ]);
        // Map paragraph_description → description (the project's existing key)
        const picks = { ...raw };
        if (picks.paragraph_description && !match.data.description) {
          picks.description = picks.paragraph_description;
          delete picks.paragraph_description;
        }
        // weathering_level → weathering (project key)
        if (picks.weathering_level) {
          picks.weathering = picks.weathering_level;
          delete picks.weathering_level;
        }
        if (!isPresent(picks)) return;
        changes.push(mkChange({
          path: `location.${match.name}`,
          label: `${match.name} — ${Object.keys(picks).length} fields`,
          kind: 'merge',
          before: pickDefined(match.data, Object.keys(picks)),
          after: picks,
          targetName: match.name,
          meta: { location: match.name },
          _apply: (proj) => {
            const ll = proj.location_library?.[match.name];
            if (ll) Object.assign(ll, picks);
          }
        }));
      });
      return changes;
    }
  };

  APPLIERS['atmospherics-builder'] = {
    label: 'Atmospherics',
    preview(out, p) {
      const changes = [];
      changes.push(...perSceneFieldChanges(out.per_scene || out.scenes || [], p, {
        time_of_day:     'time_of_day',
        weather:         'weather',
        lighting_plan:   'lighting_plan',
        sound_texture:   'sound_texture',
        sensory_anchors: 'sensory_anchors',
        atmospherics:    'atmospherics',
      }));
      return changes;
    }
  };

  APPLIERS['dressing-builder'] = {
    label: 'Set dressing plan',
    preview(out, p) {
      const changes = [];
      changes.push(...perLocationFieldChanges(out.per_location || [], p, {
        set_dressing:   'set_dressing',
        worldbuilding_hooks: 'worldbuilding_hooks',
        texture_palette: 'texture_palette',
      }));
      changes.push(...perSceneFieldChanges(out.per_scene || [], p, {
        hand_props: 'hand_props',
        hero_props: 'hero_props',
        signature_props: 'signature_props',
      }));
      if (Array.isArray(out.vfx_decisions) && out.vfx_decisions.length) {
        changes.push(mkChange({
          path: 'vfx_plan',
          label: `${out.vfx_decisions.length} VFX pipeline decisions`,
          kind: 'set',
          before: p.vfx_plan || null,
          after: out.vfx_decisions,
          _apply: (proj) => {
            proj.vfx_plan = proj.vfx_plan || { decisions: [], updated_at: 0 };
            proj.vfx_plan.decisions = out.vfx_decisions;
            proj.vfx_plan.updated_at = Date.now();
          }
        }));
      }
      return changes;
    }
  };

  APPLIERS['timeline-editor'] = {
    label: 'Timeline cut plan',
    preview(out, p) {
      const changes = [];
      const te = pickDefined(out, [
        'cut_structure', 'trim_strategy', 'match_cuts', 'j_cuts', 'l_cuts',
        'transition_style', 'overall_rhythm_diagnosis'
      ]);
      if (isPresent(te)) {
        changes.push(mkChange({
          path: 'timeline_plan',
          label: `Lock cut structure${out.cut_structure ? ' — ' + out.cut_structure : ''}`,
          kind: 'merge',
          before: p.timeline_plan || null,
          after: te,
          meta: { fields: Object.keys(te) },
          _apply: (proj) => { proj.timeline_plan = { ...(proj.timeline_plan || {}), ...te, updated_at: Date.now() }; }
        }));
      }
      return changes;
    }
  };

  APPLIERS['pacing-editor'] = {
    label: 'Pacing plan',
    preview(out, p) {
      const changes = [];
      const pe = pickDefined(out, [
        'heartbeat', 'breathing_beats', 'acceleration_beats', 'rhythm_diagnosis',
        'pacing_contract_alignment', 'tempo_map'
      ]);
      if (isPresent(pe)) {
        changes.push(mkChange({
          path: 'pacing_plan',
          label: 'Lock pacing plan',
          kind: 'merge',
          before: p.pacing_plan || null,
          after: pe,
          _apply: (proj) => { proj.pacing_plan = { ...(proj.pacing_plan || {}), ...pe, updated_at: Date.now() }; }
        }));
      }
      changes.push(...perSceneFieldChanges(out.per_scene || [], p, {
        pacing_note: 'pacing_note',
        tempo: 'tempo',
      }));
      return changes;
    }
  };

  APPLIERS['assembly-editor'] = {
    label: 'Assembly plan',
    preview(out, p) {
      const changes = [];
      const ae = pickDefined(out, [
        'assembly_order', 'sequence_strategy', 'polish_notes', 'music_cue_strategy',
        'trailer_concept'
      ]);
      if (isPresent(ae)) {
        changes.push(mkChange({
          path: 'assembly_plan',
          label: 'Lock assembly plan',
          kind: 'merge',
          before: p.assembly_plan || null,
          after: ae,
          _apply: (proj) => { proj.assembly_plan = { ...(proj.assembly_plan || {}), ...ae, updated_at: Date.now() }; }
        }));
      }
      return changes;
    }
  };

  // ────────── TIER 2 SPECIALISTS ──────────

  APPLIERS['genre-specialist'] = {
    label: 'Genre tuning',
    preview(out, p) {
      const changes = [];
      const g = pickDefined(out, ['genre_tags', 'genre_conventions', 'genre_violations', 'audience_expectations']);
      if (isPresent(g)) {
        changes.push(mkChange({
          path: 'genre_tags',
          label: 'Lock genre tags & conventions',
          kind: 'merge',
          before: p.genre_tags || null,
          after: g,
          _apply: (proj) => { proj.genre_tags = { ...(proj.genre_tags || {}), ...g, updated_at: Date.now() }; }
        }));
      }
      return changes;
    }
  };

  APPLIERS['beat-analyst'] = {
    label: 'Beat tags',
    preview(out, p) {
      return perSceneFieldChanges(out.scenes || out.per_scene || [], p, {
        beat_type:     'beat_type',
        beat_strength: 'beat_strength',
        beat_function: 'beat_function',
      }, (scene, picks) => `${scene.slug} → ${picks.beat_type || 'tag'}${picks.beat_strength ? ' (' + picks.beat_strength + ')' : ''}`);
    }
  };

  APPLIERS['continuity-supervisor'] = {
    label: 'Continuity flags',
    preview(out, p) {
      const flags = out.continuity_flags || out.flags || out.issues || [];
      if (!Array.isArray(flags) || !flags.length) return [];
      return [mkChange({
        path: 'continuity_flags',
        label: `${flags.length} continuity issue${flags.length === 1 ? '' : 's'}`,
        kind: 'set',
        before: p.continuity_flags || null,
        after: flags,
        _apply: (proj) => {
          proj.continuity_flags = flags;
          proj.continuity_flags_updated_at = Date.now();
        }
      })];
    }
  };

  APPLIERS['cinematographer'] = {
    label: 'Coverage shots',
    preview(out, p) {
      const changes = [];
      // Additional shots to add — MUST be explicit (no auto-id collisions)
      const adds = out.additional_shots || out.shots || [];
      if (Array.isArray(adds) && adds.length) {
        // Group per scene to generate fresh shot IDs at apply time
        const bySceneRef = {};
        adds.forEach((sh) => {
          const ref = sh.scene_id || sh.scene;
          const scene = findSceneByRef(p, ref);
          if (!scene) return;
          if (!bySceneRef[scene.id]) bySceneRef[scene.id] = [];
          bySceneRef[scene.id].push(sh);
        });
        Object.entries(bySceneRef).forEach(([sceneId, shots]) => {
          const scene = findSceneByRef(p, sceneId);
          changes.push(mkChange({
            path: `shot_list.add.${sceneId}`,
            label: `Add ${shots.length} shot${shots.length === 1 ? '' : 's'} to ${scene?.slug || sceneId}`,
            kind: 'append',
            before: null,
            after: shots,
            sceneSlug: scene?.slug || null,
            meta: { scene_id: sceneId, count: shots.length },
            _apply: (proj) => {
              const s = findSceneByRef(proj, sceneId);
              if (!s) return;
              proj.shot_list = proj.shot_list || [];
              const startIdx = proj.shot_list.filter(x => x.scene_id === sceneId).length;
              shots.forEach((sh, i) => {
                proj.shot_list.push({
                  id: 'sh_' + sceneId + '_' + String(startIdx + i + 1).padStart(2, '0'),
                  scene_id: sceneId,
                  slot: sh.slot || 'shot ' + (startIdx + i + 1),
                  shot_brief: { shot: sh.shot || '', action: sh.action || '', mood: sh.mood || '' },
                  duration_target_seconds: sh.duration_target_seconds || 5,
                  characters_in_frame: sh.characters_in_frame || [],
                  cinematography: pickDefined(sh, ['lens', 'framing', 'movement']),
                });
              });
            }
          }));
        });
      }
      return changes;
    }
  };

  APPLIERS['movement-choreographer'] = {
    label: 'Camera movement',
    preview(out, p) {
      return perShotFieldChanges(out.per_shot || out.shots || [], p, {
        movement: 'cinematography.movement',
      }).map(chg => {
        // The shotfield mapper used nested path — we need a custom apply
        const originalApply = chg._apply;
        chg._apply = (proj) => {
          const sh = findShot(proj, chg.meta.shot_id);
          if (!sh) return;
          sh.cinematography = sh.cinematography || {};
          // after.{'cinematography.movement': value} — extract movement
          const mv = chg.after['cinematography.movement'];
          if (isPresent(mv)) sh.cinematography.movement = mv;
        };
        return chg;
      });
    }
  };

  APPLIERS['color-theorist'] = {
    label: 'Color theory',
    preview(out, p) {
      const changes = [];
      changes.push(...perSceneFieldChanges(out.per_scene || out.scenes || [], p, {
        color_palette: 'color_palette',
        color_intent:  'color_intent',
      }));
      if (isPresent(out.global_palette_notes)) {
        changes.push(mkChange({
          path: 'vision.palette.rationale',
          label: 'Refine palette rationale',
          kind: 'merge',
          before: p.vision?.palette?.rationale || null,
          after: out.global_palette_notes,
          _apply: (proj) => {
            proj.vision = proj.vision || {};
            proj.vision.palette = proj.vision.palette || {};
            proj.vision.palette.rationale = out.global_palette_notes;
          }
        }));
      }
      return changes;
    }
  };

  APPLIERS['colorist'] = {
    label: 'Color grade plan',
    preview(out, p) {
      const cg = pickDefined(out, ['grade_style', 'lut_recommendation', 'contrast_curve', 'skin_tone_protection', 'highlight_rolloff', 'shadow_treatment']);
      if (!isPresent(cg)) return [];
      return [mkChange({
        path: 'color_grade',
        label: 'Lock color grade plan',
        kind: 'merge',
        before: p.color_grade || null,
        after: cg,
        _apply: (proj) => { proj.color_grade = { ...(proj.color_grade || {}), ...cg, updated_at: Date.now() }; }
      })];
    }
  };

  APPLIERS['dialogue-coach'] = {
    label: 'Dialogue rewrites',
    preview(out, p) {
      const changes = [];
      // Per-character rewrites — store as notes, not auto-replacing lines in scene.raw
      const perChar = out.per_character || [];
      changes.push(...perCharacterFieldChanges(perChar.map(x => ({
        ...x, character: x.character || x.name || x.character_name,
      })), p, {
        rewrites: 'dialogue_rewrites',
        voice_distinctness_score: 'voice_distinctness_score',
        notes: 'voice_coach_notes',
      }, (m, picks) => `${m.name} — ${Array.isArray(picks.dialogue_rewrites) ? picks.dialogue_rewrites.length + ' rewrites' : 'coach notes'}`));

      const top = out.top_rewrites || [];
      if (Array.isArray(top) && top.length) {
        changes.push(mkChange({
          path: 'dialogue_audit.coach_rewrites',
          label: `${top.length} priority line rewrites`,
          kind: 'set',
          before: p.dialogue_audit?.coach_rewrites || null,
          after: top,
          _apply: (proj) => {
            proj.dialogue_audit = proj.dialogue_audit || {};
            proj.dialogue_audit.coach_rewrites = top;
            proj.dialogue_audit.updated_at = Date.now();
          }
        }));
      }
      return changes;
    }
  };

  APPLIERS['cliche-detector'] = {
    label: 'Cliche flags',
    preview(out, p) {
      const flags = out.flags || out.cliches || out.per_line || [];
      if (!Array.isArray(flags) || !flags.length) return [];
      return [mkChange({
        path: 'cliche_flags',
        label: `${flags.length} cliche / on-the-nose line${flags.length === 1 ? '' : 's'}`,
        kind: 'set',
        before: p.cliche_flags || null,
        after: flags,
        _apply: (proj) => { proj.cliche_flags = [...flags]; proj.cliche_flags_updated_at = Date.now(); }
      })];
    }
  };

  APPLIERS['script-doctor'] = {
    label: 'Script doctor rewrite',
    preview(out, p) {
      const changes = [];
      // Scene-level rewrite — only actionable if we have a scene ref
      const sceneRef = out.scene_id || out.scene || out.target_scene;
      const revised = out.revised_raw || out.revised_scene || out.revised || out.revised_text;
      if (sceneRef && isPresent(revised)) {
        const scene = findSceneByRef(p, sceneRef);
        if (scene) {
          changes.push(mkChange({
            path: `scene.${scene.id}.raw`,
            label: `Rewrite scene ${scene.slug}${out.cut_percentage != null ? ' (' + Math.round(out.cut_percentage * 100) + '% shorter)' : ''}`,
            kind: 'set',
            before: scene.raw,
            after: revised,
            sceneSlug: scene.slug,
            meta: { scene_id: scene.id },
            _apply: (proj) => {
              const s = findSceneByRef(proj, scene.id);
              if (s) s.raw = revised;
            }
          }));
        }
      }
      if (isPresent(out.changes_summary)) {
        changes.push(mkChange({
          path: 'script_doctor_notes',
          label: 'Save script-doctor change summary',
          kind: 'merge',
          before: null,
          after: { summary: out.changes_summary },
          _apply: (proj) => {
            proj.script_doctor_notes = proj.script_doctor_notes || [];
            proj.script_doctor_notes.push({ summary: out.changes_summary, scene_id: sceneRef || null, at: Date.now() });
          }
        }));
      }
      return changes;
    }
  };

  APPLIERS['script-formatter'] = {
    label: 'Format issues',
    preview(out, p) {
      const issues = out.issues || out.format_issues || out.flags || [];
      if (!Array.isArray(issues) || !issues.length) return [];
      return [mkChange({
        path: 'format_issues',
        label: `${issues.length} format issue${issues.length === 1 ? '' : 's'}`,
        kind: 'set',
        before: p.format_issues || null,
        after: issues,
        _apply: (proj) => { proj.format_issues = issues; proj.format_issues_updated_at = Date.now(); }
      })];
    }
  };

  APPLIERS['subtext-writer'] = {
    label: 'Subtext layer',
    preview(out, p) {
      const changes = [];
      changes.push(...perSceneFieldChanges(out.per_scene || out.scenes || [], p, {
        subtextual_intent:   'subtextual_intent',
        character_undertones:'character_undertones',
        action_enrichments:  'action_enrichments',
        subtext:             'subtext',
      }));
      return changes;
    }
  };

  APPLIERS['prompt-smith'] = {
    label: 'Prompt rewrite',
    preview(out, p) {
      const changes = [];
      // Single-shot improvements (typical individual-invoke)
      if (out.shot_id || out.final_prompt) {
        const shot = findShot(p, out.shot_id);
        if (shot) {
          const picks = pickDefined(out, ['final_prompt','negative_prompt','model_target','character_refs_used']);
          if (out.shot) picks['shot_brief.shot'] = out.shot;
          if (out.action) picks['shot_brief.action'] = out.action;
          if (out.mood) picks['shot_brief.mood'] = out.mood;
          if (isPresent(picks)) {
            changes.push(mkChange({
              path: `shot.${shot.id}.prompt`,
              label: `Rewrite prompt for ${shot.slot || shot.id}`,
              kind: 'merge',
              before: pickDefined(shot, ['final_prompt','negative_prompt','model_target','character_refs_used']),
              after: picks,
              meta: { shot_id: shot.id },
              _apply: (proj) => {
                const s = findShot(proj, shot.id);
                if (!s) return;
                if (out.shot)  { s.shot_brief = s.shot_brief || {}; s.shot_brief.shot = out.shot; }
                if (out.action){ s.shot_brief = s.shot_brief || {}; s.shot_brief.action = out.action; }
                if (out.mood)  { s.shot_brief = s.shot_brief || {}; s.shot_brief.mood = out.mood; }
                if (out.final_prompt)    s.final_prompt = out.final_prompt;
                if (out.negative_prompt) s.negative_prompt = out.negative_prompt;
                if (out.model_target)    s.model_target = out.model_target;
                if (Array.isArray(out.character_refs_used)) s.character_refs_used = out.character_refs_used;
              }
            }));
          }
        }
      }
      return changes;
    }
  };

  APPLIERS['scene-architect'] = {
    label: 'Scene architecture',
    preview(out, p) {
      const changes = [];
      changes.push(...perSceneFieldChanges(out.per_scene || out.scenes || [], p, {
        scene_structure: 'scene_structure',
        entry_point:     'scene_entry_point',
        exit_point:      'scene_exit_point',
        stakes:          'stakes',
        turn:            'scene_turn',
      }));
      return changes;
    }
  };

  APPLIERS['shot-calibrator'] = {
    label: 'Per-model prompt variants',
    preview(out, p) {
      const changes = [];
      // Schema A: per-shot batch — when called in a context that includes
      // a shot list, the agent returns {per_shot:[{shot_id, variants:{...}}]}
      const items = out.per_shot || out.shots || [];
      items.forEach((item) => {
        const shot = findShot(p, item.shot_id);
        if (!shot) return;
        const variants = item.variants || item.model_variants || item.per_model_prompt
                      || pickDefined(item, ['kling-3','veo-3','hailuo','seedance-turbo','kling','veo','hailuo','seedance']);
        if (!isPresent(variants)) return;
        changes.push(mkChange({
          path: `shot.${shot.id}.model_variants`,
          label: `${shot.slot || shot.id} — ${Object.keys(variants).length} model variants`,
          kind: 'merge',
          before: shot.model_variants || null,
          after: variants,
          meta: { shot_id: shot.id },
          _apply: (proj) => {
            const s = findShot(proj, shot.id);
            if (!s) return;
            s.model_variants = { ...(s.model_variants || {}), ...variants };
          }
        }));
      });
      // Schema B: single-shot or strategic call — agent returns
      //   {per_model_prompt:{...}, per_model_notes:{...}}
      // (registry line 1480). When fired without a shot_id, this is a
      // template/strategic output. We save it as a project-level template
      // future per-shot calls can reference, AND if the input mentioned
      // a shot_id we attach to that shot directly.
      if (out.per_model_prompt && isPresent(out.per_model_prompt) && !items.length) {
        const targetShotId = out.shot_id || out.target_shot_id;
        const targetShot = targetShotId ? findShot(p, targetShotId) : null;
        if (targetShot) {
          changes.push(mkChange({
            path: `shot.${targetShot.id}.model_variants`,
            label: `${targetShot.slot || targetShot.id} — ${Object.keys(out.per_model_prompt).length} model variants`,
            kind: 'merge',
            before: targetShot.model_variants || null,
            after: out.per_model_prompt,
            meta: { shot_id: targetShot.id },
            _apply: (proj) => {
              const s = findShot(proj, targetShot.id);
              if (!s) return;
              s.model_variants = { ...(s.model_variants || {}), ...out.per_model_prompt };
            }
          }));
        } else {
          // Strategic / template-level call (no specific shot). Save as a
          // reference template under project.shot_calibrator_template that
          // future per-shot calls can copy from.
          const tmpl = pickDefined(out, ['per_model_prompt','per_model_notes']);
          changes.push(mkChange({
            path: 'shot_calibrator_template',
            label: `Save model-variant template (${Object.keys(out.per_model_prompt).length} models)`,
            kind: 'merge',
            before: p.shot_calibrator_template || null,
            after: tmpl,
            meta: { models: Object.keys(out.per_model_prompt) },
            _apply: (proj) => {
              proj.shot_calibrator_template = { ...(proj.shot_calibrator_template || {}), ...tmpl, updated_at: Date.now() };
            }
          }));
        }
      }
      return changes;
    }
  };

  APPLIERS['character-sculptor'] = {
    label: 'Character polish',
    preview(out, p) {
      const changes = [];
      // Single-character invoke (individual flow)
      const name = out.name || out.character_name || out.character;
      if (name) {
        const match = findCharacter(p, name);
        if (match) {
          const picks = pickDefined(out, ['canonical_description','polished','description','visual_anchors','consistency_phrase']);
          // Normalize: whatever "main" description key is present → canonical_description
          const canonical = picks.canonical_description || picks.polished || picks.description;
          const mapped = {};
          if (isPresent(canonical)) mapped.canonical_description = canonical;
          if (isPresent(picks.visual_anchors)) mapped.visual_anchors = picks.visual_anchors;
          if (isPresent(picks.consistency_phrase)) mapped.consistency_phrase = picks.consistency_phrase;
          if (isPresent(mapped)) {
            changes.push(mkChange({
              path: `character.${match.name}`,
              label: `${match.name} — polished description${mapped.visual_anchors ? ' + anchors' : ''}`,
              kind: 'merge',
              before: pickDefined(match.data, Object.keys(mapped)),
              after: mapped,
              targetName: match.name,
              _apply: (proj) => {
                proj.character_bible = proj.character_bible || {};
                proj.character_bible[match.name] = proj.character_bible[match.name] || {};
                Object.assign(proj.character_bible[match.name], mapped);
              }
            }));
          }
        }
      }
      // Batch: {characters: [...]} shape
      if (Array.isArray(out.characters)) {
        changes.push(...APPLIERS['visual-character-builder'].preview(out, p));
      }
      return changes;
    }
  };

  APPLIERS['wardrobe-props'] = {
    label: 'Wardrobe & props',
    preview(out, p) {
      const changes = [];
      const name = out.character_name || out.character || out.name;
      if (name) {
        const match = findCharacter(p, name);
        if (match) {
          const picks = {};
          const wardrobe = out.wardrobe_default || out.wardrobe;
          const props = out.signature_props || out.props;
          if (isPresent(wardrobe)) picks.wardrobe_default = wardrobe;
          if (isPresent(props)) { picks.signature_props = props; picks.props = props; }
          if (isPresent(out.period_notes)) picks.period_notes = out.period_notes;
          if (isPresent(picks)) {
            changes.push(mkChange({
              path: `character.${match.name}`,
              label: `${match.name} — wardrobe & props`,
              kind: 'merge',
              before: pickDefined(match.data, Object.keys(picks)),
              after: picks,
              targetName: match.name,
              _apply: (proj) => {
              proj.character_bible = proj.character_bible || {};
              proj.character_bible[match.name] = proj.character_bible[match.name] || {};
              Object.assign(proj.character_bible[match.name], picks);
            }
            }));
          }
        }
      }
      // Batch flavour
      if (Array.isArray(out.per_character)) {
        changes.push(...perCharacterFieldChanges(out.per_character.map(x => ({
          ...x, character: x.character || x.name || x.character_name,
        })), p, {
          wardrobe_default:'wardrobe_default',
          signature_props: 'signature_props',
          period_notes:    'period_notes',
        }));
      }
      return changes;
    }
  };

  APPLIERS['emotion-mapper'] = {
    label: 'Emotion map',
    preview(out, p) {
      const changes = [];
      const items = out.per_scene || out.scenes || [];
      // Each item: {scene_id, emotions: [{character, state, intensity, visible_signs}]}
      changes.push(...perSceneFieldChanges(items, p, {
        emotions:    'emotion_map',
        emotion_arc: 'emotion_arc',
      }));
      return changes;
    }
  };

  APPLIERS['voice-consistency-auditor'] = {
    label: 'Voice consistency flags',
    preview(out, p) {
      const flags = out.flags || out.inconsistencies || out.issues || [];
      if (!Array.isArray(flags) || !flags.length) return [];
      return [mkChange({
        path: 'voice_consistency_flags',
        label: `${flags.length} voice inconsistency flag${flags.length === 1 ? '' : 's'}`,
        kind: 'set',
        before: p.voice_consistency_flags || null,
        after: flags,
        _apply: (proj) => { proj.voice_consistency_flags = [...flags]; proj.voice_consistency_flags_updated_at = Date.now(); }
      })];
    }
  };

  APPLIERS['adr-supervisor'] = {
    label: 'ADR notes',
    preview(out, p) {
      const notes = out.adr_flags || out.flags || out.per_line || out.notes || [];
      if (!Array.isArray(notes) || !notes.length) return [];
      return [mkChange({
        path: 'adr_notes',
        label: `${notes.length} ADR flag${notes.length === 1 ? '' : 's'}`,
        kind: 'set',
        before: p.adr_notes || null,
        after: notes,
        _apply: (proj) => { proj.adr_notes = notes; proj.adr_notes_updated_at = Date.now(); }
      })];
    }
  };

  APPLIERS['location-scout'] = {
    label: 'Location description',
    preview(out, p) {
      const changes = [];
      // Single-location (individual flow)
      const name = out.location_name || out.name;
      if (name) {
        const match = findLocation(p, name);
        if (match) {
          const picks = pickDefined(out, ['description','establishing_prompt','sensory_anchors','paragraph']);
          if (picks.paragraph && !picks.description) { picks.description = picks.paragraph; delete picks.paragraph; }
          if (isPresent(picks)) {
            changes.push(mkChange({
              path: `location.${match.name}`,
              label: `${match.name} — description & anchors`,
              kind: 'merge',
              before: pickDefined(match.data, Object.keys(picks)),
              after: picks,
              targetName: match.name,
              _apply: (proj) => {
                proj.location_library = proj.location_library || {};
                proj.location_library[match.name] = proj.location_library[match.name] || {};
                Object.assign(proj.location_library[match.name], picks);
              }
            }));
          }
        }
      }
      // Batch: {locations: [...]}
      if (Array.isArray(out.locations)) {
        changes.push(...APPLIERS['environment-builder'].preview(out, p));
      }
      return changes;
    }
  };

  APPLIERS['architecture-designer'] = {
    label: 'Architecture specs',
    preview(out, p) {
      const changes = [];
      const items = out.per_location || out.locations || [];
      changes.push(...perLocationFieldChanges(items.map(x => ({
        ...x, location: x.location || x.name || x.location_name,
      })), p, {
        building_type:     'building_type',
        era:               'era',
        materials:         'materials',
        scale:             'scale',
        architectural_signature: 'architectural_signature',
      }));
      return changes;
    }
  };

  APPLIERS['lighting-designer'] = {
    label: 'Lighting plan',
    preview(out, p) {
      const changes = [];
      const items = out.per_scene || [];
      changes.push(...perSceneFieldChanges(items, p, {
        key_light:        'lighting_plan.key_light',
        fill_light:       'lighting_plan.fill_light',
        rim_light:        'lighting_plan.rim_light',
        motivated_source: 'lighting_plan.motivated_source',
        mood_note:        'lighting_plan.mood_note',
      }, (scene, picks) => `${scene.slug} lighting`));
      // Special: flatten lighting fields to scene.lighting_plan rather than direct set
      changes.forEach(chg => {
        const afterFlat = chg.after;
        chg.after = {};
        for (const [k, v] of Object.entries(afterFlat)) {
          const short = k.split('.').pop();
          chg.after[short] = v;
        }
        chg.label = chg.sceneSlug ? `${chg.sceneSlug} — lighting plan` : chg.label;
        chg._apply = (proj) => {
          const s = findSceneByRef(proj, chg.meta.scene_id);
          if (!s) return;
          s.lighting_plan = { ...(s.lighting_plan || {}), ...chg.after };
        };
      });
      // Single-scene invoke (individual flow) — output may be flat
      if (!items.length) {
        const sceneRef = out.scene_id;
        const flat = pickDefined(out, ['key_light','fill_light','rim_light','motivated_source','mood_note']);
        if (sceneRef && isPresent(flat)) {
          const scene = findSceneByRef(p, sceneRef);
          if (scene) {
            changes.push(mkChange({
              path: `scene.${scene.id}.lighting_plan`,
              label: `${scene.slug} — lighting plan`,
              kind: 'merge',
              before: scene.lighting_plan || null,
              after: flat,
              sceneSlug: scene.slug,
              meta: { scene_id: scene.id },
              _apply: (proj) => {
                const s = findSceneByRef(proj, scene.id);
                if (s) s.lighting_plan = { ...(s.lighting_plan || {}), ...flat };
              }
            }));
          }
        }
      }
      return changes;
    }
  };

  APPLIERS['weather-coordinator'] = {
    label: 'Weather & time',
    preview(out, p) {
      return perSceneFieldChanges(out.per_scene || out.scenes || [], p, {
        time_of_day:     'time_of_day',
        weather:         'weather',
        air_quality:     'air_quality',
        temperature_feel:'temperature_feel',
        body_language:   'weather_body_language',
      });
    }
  };

  APPLIERS['sound-designer'] = {
    label: 'Sound design',
    preview(out, p) {
      return perSceneFieldChanges(out.per_scene || out.scenes || [], p, {
        sound_design:  'sound_design',
        sound_texture: 'sound_texture',
        ambience:      'ambience',
        score_note:    'score_note',
      });
    }
  };

  APPLIERS['props-master'] = {
    label: 'Props',
    preview(out, p) {
      return perSceneFieldChanges(out.per_scene || out.scenes || [], p, {
        hero_props:      'hero_props',
        signature_props: 'signature_props',
        active_props:    'active_props',
        props:           'props',
      });
    }
  };

  APPLIERS['set-dresser'] = {
    label: 'Set dressing',
    preview(out, p) {
      return perLocationFieldChanges((out.per_location || []).map(x => ({
        ...x, location: x.location || x.name || x.location_name,
      })), p, {
        wall_dressing:       'wall_dressing',
        surface_dressing:    'surface_dressing',
        worldbuilding_hooks: 'worldbuilding_hooks',
        density:             'density_calibration',
      });
    }
  };

  APPLIERS['vfx-supervisor'] = {
    label: 'VFX flags',
    preview(out, p) {
      const changes = [];
      const items = out.per_shot || out.shots || out.vfx_shots || [];
      items.forEach((it) => {
        const shot = findShot(p, it.shot_id || it.id);
        if (!shot) return;
        const vfx = pickDefined(it, ['vfx_type','complexity','post_hours','notes','pipeline']);
        if (!isPresent(vfx)) return;
        changes.push(mkChange({
          path: `shot.${shot.id}.vfx`,
          label: `${shot.slot || shot.id} — VFX (${vfx.vfx_type || 'flagged'}${vfx.complexity ? ', ' + vfx.complexity : ''})`,
          kind: 'merge',
          before: shot.vfx || null,
          after: vfx,
          meta: { shot_id: shot.id },
          _apply: (proj) => {
            const s = findShot(proj, shot.id);
            if (!s) return;
            s.vfx = { ...(s.vfx || {}), ...vfx };
          }
        }));
      });
      if (isPresent(out.total_post_hours) || isPresent(out.summary)) {
        changes.push(mkChange({
          path: 'vfx_plan.summary',
          label: `VFX summary${out.total_post_hours ? ' — ' + out.total_post_hours + ' post-hours' : ''}`,
          kind: 'merge',
          before: p.vfx_plan?.summary || null,
          after: pickDefined(out, ['total_post_hours','summary','flagged_shot_count']),
          _apply: (proj) => {
            proj.vfx_plan = proj.vfx_plan || {};
            Object.assign(proj.vfx_plan, pickDefined(out, ['total_post_hours','summary','flagged_shot_count']));
            proj.vfx_plan.updated_at = Date.now();
          }
        }));
      }
      return changes;
    }
  };

  APPLIERS['editor'] = {
    label: 'Editor notes',
    preview(out, p) {
      const e = pickDefined(out, ['cut_notes','edit_strategy','transition_notes','per_cut_notes']);
      if (!isPresent(e)) return [];
      return [mkChange({
        path: 'edit_notes',
        label: 'Save editor notes',
        kind: 'merge',
        before: p.edit_notes || null,
        after: e,
        _apply: (proj) => { proj.edit_notes = { ...(proj.edit_notes || {}), ...e, updated_at: Date.now() }; }
      })];
    }
  };

  APPLIERS['transition-designer'] = {
    label: 'Transitions',
    preview(out, p) {
      const items = out.per_cut || out.transitions || [];
      if (!Array.isArray(items) || !items.length) return [];
      return [mkChange({
        path: 'transitions',
        label: `${items.length} transition${items.length === 1 ? '' : 's'}`,
        kind: 'set',
        before: p.transitions || null,
        after: items,
        _apply: (proj) => { proj.transitions = [...items]; proj.transitions_updated_at = Date.now(); }
      })];
    }
  };

  APPLIERS['pacing-doctor'] = {
    label: 'Pacing fixes',
    preview(out, p) {
      const changes = [];
      changes.push(...perSceneFieldChanges(out.per_scene || out.scenes || [], p, {
        pacing_issue: 'pacing_issue',
        pacing_fix:   'pacing_fix',
        tempo:        'tempo',
      }));
      return changes;
    }
  };

  APPLIERS['runtime-calculator'] = {
    label: 'Runtime estimates',
    preview(out, p) {
      const changes = [];
      changes.push(...perSceneFieldChanges(out.per_scene || out.scenes || [], p, {
        estimated_runtime_seconds: 'estimated_runtime_seconds',
        runtime_confidence:        'runtime_confidence',
      }));
      if (out.total_runtime_seconds != null || out.target_runtime_seconds != null) {
        const re = pickDefined(out, ['total_runtime_seconds','target_runtime_seconds','variance','runtime_notes']);
        changes.push(mkChange({
          path: 'runtime_estimate',
          label: `Total estimated runtime${out.total_runtime_seconds ? ' — ' + out.total_runtime_seconds + 's' : ''}`,
          kind: 'merge',
          before: p.runtime_estimate || null,
          after: re,
          _apply: (proj) => { proj.runtime_estimate = { ...(proj.runtime_estimate || {}), ...re, updated_at: Date.now() }; }
        }));
      }
      return changes;
    }
  };

  APPLIERS['trailer-cutter'] = {
    label: 'Trailer cut',
    preview(out, p) {
      const tc = pickDefined(out, ['trailer_beats','hook_shot','reveal_shot','tag_line','duration_seconds','structure']);
      if (!isPresent(tc)) return [];
      return [mkChange({
        path: 'trailer_cut',
        label: `Trailer plan${tc.duration_seconds ? ' (' + tc.duration_seconds + 's)' : ''}`,
        kind: 'merge',
        before: p.trailer_cut || null,
        after: tc,
        _apply: (proj) => { proj.trailer_cut = { ...(proj.trailer_cut || {}), ...tc, updated_at: Date.now() }; }
      })];
    }
  };

  APPLIERS['polish-pass'] = {
    label: 'Polish pass',
    preview(out, p) {
      const notes = out.notes || out.polish_notes || [];
      const summary = out.summary || out.overall;
      const changes = [];
      if (Array.isArray(notes) && notes.length) {
        changes.push(mkChange({
          path: 'polish_notes',
          label: `${notes.length} polish note${notes.length === 1 ? '' : 's'}`,
          kind: 'set',
          before: p.polish_notes || null,
          after: notes,
          _apply: (proj) => { proj.polish_notes = notes; proj.polish_notes_updated_at = Date.now(); }
        }));
      }
      if (isPresent(summary)) {
        changes.push(mkChange({
          path: 'polish_summary',
          label: 'Save polish summary',
          kind: 'set',
          before: p.polish_summary || null,
          after: summary,
          _apply: (proj) => { proj.polish_summary = summary; }
        }));
      }
      return changes;
    }
  };

  APPLIERS['music-supervisor'] = {
    label: 'Music cues',
    preview(out, p) {
      const cues = out.cues || out.music_cues || out.per_scene || [];
      if (!Array.isArray(cues) || !cues.length) return [];
      return [mkChange({
        path: 'music_cues',
        label: `${cues.length} music cue${cues.length === 1 ? '' : 's'}`,
        kind: 'set',
        before: p.music_cues || null,
        after: cues,
        _apply: (proj) => { proj.music_cues = cues; proj.music_cues_updated_at = Date.now(); }
      })];
    }
  };

  // ─── Generic fallback applier ────────────────────────────────────────────

  function genericApplier(agentId) {
    return {
      label: agentId,
      preview(out, p) {
        if (!isPresent(out)) return [];
        return [mkChange({
          path: `agent_notes.${agentId}`,
          label: `Save ${agentId} output as notes`,
          kind: 'note',
          before: p.agent_notes?.[agentId]?.output || null,
          after: out,
          _apply: (proj) => {
            proj.agent_notes = proj.agent_notes || {};
            proj.agent_notes[agentId] = { output: out, updated_at: Date.now() };
          }
        })];
      }
    };
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  function getApplier(agentId) {
    const id = resolveId(agentId);
    return APPLIERS[id] || genericApplier(id);
  }

  function preview(agentId, output, project) {
    const applier = getApplier(agentId);
    try {
      const changes = applier.preview(output || {}, project || {}) || [];
      // Filter out no-op changes — applying them wouldn't change project state
      const real = changes.filter(c => !isNoOp(c));
      return {
        agent_id: resolveId(agentId),
        label: applier.label || agentId,
        count: real.length,
        changes: real,
        no_changes: real.length === 0,
      };
    } catch (e) {
      console.error('[SB_Appliers.preview]', agentId, e);
      return { agent_id: resolveId(agentId), label: applier.label || agentId, count: 0, changes: [], no_changes: true, error: e.message };
    }
  }

  function apply(agentId, output, project, selectedIds) {
    const pv = preview(agentId, output, project);
    if (pv.error) return { applied: 0, skipped: 0, errors: [pv.error] };
    let applied = 0, skipped = 0;
    const errors = [];
    pv.changes.forEach(chg => {
      if (Array.isArray(selectedIds) && !selectedIds.includes(chg.id)) { skipped++; return; }
      if (!chg._apply) { skipped++; return; }
      try { chg._apply(project); applied++; }
      catch (e) { errors.push(`${chg.label}: ${e.message}`); }
    });
    return { applied, skipped, errors, agent_id: pv.agent_id, changes: pv.changes };
  }

  // Apply every agent's output from a crew run in one shot
  function applyCrew(crewData, project, selectedChangeIds) {
    if (!crewData || typeof crewData !== 'object') return { applied: 0, skipped: 0, errors: [] };
    const totals = { applied: 0, skipped: 0, errors: [], per_agent: {} };
    Object.entries(crewData).forEach(([agentId, output]) => {
      const r = apply(agentId, output, project, selectedChangeIds);
      totals.applied += r.applied;
      totals.skipped += r.skipped;
      totals.errors.push(...r.errors);
      totals.per_agent[agentId] = { applied: r.applied, skipped: r.skipped };
    });
    return totals;
  }

  // Preview across a whole crew run — returns flat array of {agent_id, changes}
  function previewCrew(crewData, project) {
    if (!crewData || typeof crewData !== 'object') return [];
    return Object.entries(crewData).map(([agentId, output]) => preview(agentId, output, project));
  }

  window.SB_Appliers = {
    preview,
    apply,
    previewCrew,
    applyCrew,
    // Introspection helpers for debugging & UI
    hasSpecificApplier(agentId) { return !!APPLIERS[resolveId(agentId)]; },
    listAgentsWithAppliers()    { return Object.keys(APPLIERS); },
  };
})();
