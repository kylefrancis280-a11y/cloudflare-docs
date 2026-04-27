// ═══════════════════════════════════════════════════════════════════════════
//  SHOTBREAK — Prompt Enricher
//  ──────────────────────────────────────────────────────────────────────────
//  Builds the COMPLETE prompt that gets sent to WaveSpeed for each shot,
//  injecting all the consistency anchors the user has locked in earlier
//  workflow steps. Without this, every shot is generated against a thin
//  "shot description + action + mood" string and the models drift wildly
//  between clips — different faces, different palettes, different lenses.
//
//  WHAT GETS INJECTED (when available):
//    1. Character anchors      — consistency_phrase + visual_anchors per
//                                character in frame
//    2. Wardrobe                — wardrobe_default per character
//    3. Look anchors            — visual_grammar (dominant_lens_range,
//                                framing_principle, movement_philosophy)
//                                + vision.palette + lens_language
//    4. Scene anchors           — lighting_plan, atmospherics, weather,
//                                color_palette
//    5. Negative prompt         — project.prompt_strategy.global_negative_prompt
//    6. i2v reference URL       — character_bible[name].reference_image_url
//                                (auto-routes WaveSpeed to image-to-video)
//
//  PER-MODEL FORMAT TUNING:
//    Different models respond best to different prompt structures.
//    - Seedance: terse, comma-separated, characters first
//    - Kling: character-led, micro-expressions emphasized
//    - Veo: cinematography-heavy, environment-led
//    - Hailuo: stylized/painterly, mood-first
//
//  USAGE:
//    const r = SB_Enricher.enrich(shot, project, { model: 'seedance-turbo' });
//    // r = { prompt: "...", negative_prompt: "...", character_image_url: "..."|null,
//    //       diagnostics: { anchors_used, length, model } }
//
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ─── Helpers ────────────────────────────────────────────────────────────

  function isNonEmpty(v) {
    if (v == null) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.keys(v).length > 0;
    return true;
  }

  function joinList(arr, sep) {
    if (!Array.isArray(arr)) return '';
    return arr.filter(isNonEmpty).join(sep || ', ');
  }

  function trimPunct(s) {
    return String(s || '').trim().replace(/[,;.\s]+$/, '').replace(/^[,;.\s]+/, '');
  }

  function fmtSentence(s) {
    s = trimPunct(s);
    if (!s) return '';
    return /[.!?]$/.test(s) ? s : s + '.';
  }

  // Pull a character's full anchor pack from the project bible. Returns null
  // if no entry exists (caller falls back to bare name in prompt).
  function characterAnchors(project, name) {
    const bible = project?.character_bible || {};
    const c = bible[name] || bible[Object.keys(bible).find(k => k.toLowerCase() === String(name).toLowerCase())];
    if (!c) return null;
    const anchors = {
      name,
      consistency_phrase: c.consistency_phrase || '',
      canonical_description: c.canonical_description || '',
      visual_anchors: Array.isArray(c.visual_anchors) ? c.visual_anchors : [],
      wardrobe_default: c.wardrobe_default || '',
      signature_props: Array.isArray(c.signature_props) ? c.signature_props : [],
      reference_image_url: c.reference_image_url || null,
    };
    // The CORE anchor — every prompt should carry this. Prefer
    // consistency_phrase (10-15 word prompt-ready phrase) over canonical
    // (50-word fuller description) for token economy. Use canonical when
    // consistency_phrase is missing.
    anchors.core = anchors.consistency_phrase || anchors.canonical_description;
    return anchors;
  }

  // Collect per-scene anchors that should ride along with shots in this
  // scene (lighting plan, weather, atmospherics, color palette). These are
  // the things atmospherics/dressing crews wrote during the Coverage step.
  function sceneAnchors(project, sceneId) {
    const scene = (project?.script?.normalized?.scenes || []).find(s => s.id === sceneId);
    if (!scene) return null;
    return {
      time_of_day: scene.time_of_day || (scene.time === 'NIGHT' ? 'night' : ''),
      weather: scene.weather || '',
      lighting_plan: scene.lighting_plan || null,
      atmospherics: scene.atmospherics || '',
      color_palette: scene.color_palette || '',
      sound_texture: scene.sound_texture || '',
      sensory_anchors: scene.sensory_anchors || [],
      hero_props: scene.hero_props || scene.signature_props || scene.props || [],
    };
  }

  // Collect project-level look anchors. These are constant for every shot
  // in the film. If unavailable, prompts gracefully degrade to whatever's
  // there — but the model is more likely to drift.
  function projectAnchors(project) {
    const v = project?.vision || {};
    const vg = project?.visual_grammar || {};
    const cg = project?.color_grade || null;
    return {
      logline: v.logline || '',
      tonal_anchors: v.tonal_anchors || '',
      lens_language: v.lens_language || '',
      pacing_contract: v.pacing_contract || '',
      genre: v.genre_interpretation || (project?.genre_tags?.genre_tags) || '',
      // Visual grammar (locked by Visual Director)
      dominant_lens_range: vg.dominant_lens_range || '',
      framing_principle: vg.framing_principle || '',
      movement_philosophy: vg.movement_philosophy || 'static-first',
      composition_rules: Array.isArray(vg.composition_rules) ? vg.composition_rules : [],
      // Palette (locked by Visual Director / Color Theorist)
      master_palette: v.palette?.master || v.palette?.primary || null,
      palette_logic: v.palette?.rationale || v.palette?.logic || '',
      // Color grade (locked by Colorist)
      grade_style: cg?.grade_style || '',
      lut_recommendation: cg?.lut_recommendation || '',
      // Negative prompt (locked by Prompt Writer)
      global_negative_prompt: project?.prompt_strategy?.global_negative_prompt || '',
    };
  }

  // ─── Per-model prompt formatters ────────────────────────────────────────

  // Each formatter takes the same anchor bundle and arranges it for a
  // specific model's strengths. They share a common base — character +
  // action + look — but pivot which gets emphasis.

  function formatSeedance(b) {
    // Seedance: terse, comma-separated, characters/wardrobe first.
    // Strong with literal description, weaker with abstract cinematography
    // jargon. Keep wardrobe + props + locations tight.
    const parts = [];
    parts.push(...b.charLines);
    parts.push(...b.wardrobeLines);
    parts.push(b.action);
    parts.push(b.lookLine);
    parts.push(b.paletteLine);
    parts.push(b.lensLine);
    parts.push(b.lightingLine);
    parts.push(b.weatherLine);
    parts.push(b.dialogueLine);
    return parts.filter(isNonEmpty).map(trimPunct).join(', ');
  }

  function formatKling(b) {
    // Kling: character-led, micro-expression emphasis. Open with character
    // anchor + facial/emotional detail, then framing, then environment.
    const parts = [];
    parts.push(b.charPrimary);
    parts.push(b.action);
    parts.push(b.framingLine);
    parts.push(b.lensLine);
    parts.push(b.lightingLine);
    parts.push(b.paletteLine);
    parts.push(b.dialogueLine);
    parts.push(b.lookLine);
    return parts.filter(isNonEmpty).map(fmtSentence).join(' ');
  }

  function formatVeo(b) {
    // Veo: cinematography-heavy, environment-led. Lens + framing + camera
    // movement + light + palette get top billing. Characters are stage
    // dressing in this format.
    const parts = [];
    parts.push(b.framingLine);
    parts.push(b.lensLine);
    parts.push(b.movementLine);
    parts.push(b.lightingLine);
    parts.push(b.paletteLine);
    parts.push(b.weatherLine);
    parts.push(b.action);
    parts.push(...b.charLines);
    parts.push(...b.wardrobeLines);
    parts.push(b.lookLine);
    parts.push(b.dialogueLine);
    return parts.filter(isNonEmpty).map(fmtSentence).join(' ');
  }

  function formatHailuo(b) {
    // Hailuo: stylized/painterly. Mood + tonal + palette + texture FIRST.
    const parts = [];
    parts.push(b.tonalLine);
    parts.push(b.paletteLine);
    parts.push(b.lookLine);
    parts.push(b.action);
    parts.push(b.charPrimary);
    parts.push(b.lightingLine);
    parts.push(b.lensLine);
    return parts.filter(isNonEmpty).map(fmtSentence).join(' ');
  }

  function formatUniversal(b) {
    // Default — tries to be balanced. Used when model unknown.
    const parts = [];
    parts.push(b.charPrimary);
    parts.push(b.action);
    parts.push(b.framingLine);
    parts.push(b.lensLine);
    parts.push(b.lightingLine);
    parts.push(b.paletteLine);
    parts.push(b.weatherLine);
    parts.push(...b.wardrobeLines);
    parts.push(b.lookLine);
    parts.push(b.dialogueLine);
    return parts.filter(isNonEmpty).map(fmtSentence).join(' ');
  }

  function pickFormatter(model) {
    if (!model) return formatUniversal;
    const m = String(model).toLowerCase();
    if (m.includes('seedance')) return formatSeedance;
    if (m.includes('kling')) return formatKling;
    if (m.includes('veo')) return formatVeo;
    if (m.includes('hailuo') || m.includes('minimax')) return formatHailuo;
    return formatUniversal;
  }

  // ─── Main entry point ───────────────────────────────────────────────────
  //
  // shot can be one of two shapes (we tolerate both):
  //   A. Workflow shot (project.shot_list[*]):
  //        { id, scene_id, slot, shot_brief: {shot, action, mood},
  //          characters_in_frame, duration_target_seconds, final_prompt?,
  //          model_target?, cinematography? }
  //   B. Media Hub legacy shot (rD.scenes[*].shots[*]):
  //        { type, camera, description, dialogue, characters_in_frame,
  //          cine, duration }
  //   C. Pre-staged shot from SB_WorkflowStaged.shots:
  //        { id, prompt, scene_id, slot, duration }
  //
  // project can be the workflow project (rich anchors) OR null/empty
  // (degraded mode — same output as old buildPrompt would produce).

  function enrich(shot, project, opts) {
    opts = opts || {};
    const model = opts.model || 'seedance-turbo';
    const heading = opts.heading || '';

    // 1. Resolve character anchors
    const inFrame = shot.characters_in_frame || shot.chars || [];
    const charAnchorsList = inFrame
      .map(name => characterAnchors(project, name))
      .filter(Boolean);

    // Auto-pick reference image for i2v: first character in frame WITH a ref
    // image wins. This mirrors V.pickCharImage's ordering.
    const refImageEntry = charAnchorsList.find(c => isNonEmpty(c.reference_image_url));
    const character_image_url = refImageEntry ? refImageEntry.reference_image_url : null;

    // Build character lines — prefer the prompt-ready consistency_phrase,
    // fall back to canonical_description, fall back to bare name.
    const charLines = inFrame.map((name, i) => {
      const a = charAnchorsList.find(x => x.name === name) || charAnchorsList[i];
      if (!a) return name;  // bare name when no anchor
      // Visual anchors are 3-5 distinctive details; include them on the FIRST
      // character mention in this prompt — they're the "fingerprints" the
      // models latch onto.
      const anchors = a.visual_anchors.length ? ' (' + joinList(a.visual_anchors.slice(0, 4)) + ')' : '';
      return `${name}: ${a.core}${anchors}`;
    });

    // First character's wardrobe line — wardrobe is the second-strongest
    // consistency anchor after face, so include it explicitly.
    const wardrobeLines = charAnchorsList
      .filter(c => isNonEmpty(c.wardrobe_default))
      .slice(0, 2)  // cap at 2 to keep prompts under model token limits
      .map(c => `${c.name} wardrobe: ${c.wardrobe_default}`);

    // 2. Scene anchors
    const sa = sceneAnchors(project, shot.scene_id) || {};
    const lightingLine = (() => {
      const lp = sa.lighting_plan;
      if (!lp || !isNonEmpty(lp)) return '';
      const bits = [];
      if (lp.motivated_source) bits.push(`light source ${lp.motivated_source}`);
      if (lp.key_light) bits.push(`key ${lp.key_light}`);
      if (lp.mood_note) bits.push(lp.mood_note);
      return bits.length ? 'Lighting: ' + bits.join(', ') : '';
    })();
    const weatherLine = (() => {
      const bits = [];
      if (sa.time_of_day) bits.push(sa.time_of_day);
      if (sa.weather) bits.push(sa.weather);
      if (sa.atmospherics) bits.push(sa.atmospherics);
      return bits.length ? bits.join(', ') : '';
    })();

    // 3. Project look anchors
    const pa = projectAnchors(project);
    const paletteLine = (() => {
      const localPalette = sa.color_palette;
      if (isNonEmpty(localPalette)) return 'Palette: ' + localPalette;
      const bits = [];
      if (Array.isArray(pa.master_palette) && pa.master_palette.length) {
        bits.push(pa.master_palette.slice(0, 4).join(', '));
      }
      if (pa.palette_logic) bits.push(pa.palette_logic);
      return bits.length ? 'Palette: ' + bits.join(' — ') : '';
    })();
    const lensLine = (() => {
      // Per-shot lens overrides project default
      const cine = shot.cinematography || shot.cine || {};
      const lens = cine.lens || pa.dominant_lens_range || pa.lens_language;
      return lens ? 'Lens: ' + lens : '';
    })();
    const framingLine = (() => {
      const cine = shot.cinematography || shot.cine || {};
      const framing = cine.framing || shot.slot || '';
      const principle = pa.framing_principle;
      const parts = [];
      if (framing) parts.push(framing);
      if (principle) parts.push(principle);
      return parts.length ? 'Framing: ' + parts.join(', ') : '';
    })();
    const movementLine = (() => {
      const cine = shot.cinematography || shot.cine || {};
      const m = cine.movement || pa.movement_philosophy;
      return m ? 'Camera: ' + m : '';
    })();
    const lookLine = (() => {
      const bits = [];
      if (pa.tonal_anchors) bits.push(pa.tonal_anchors);
      if (pa.grade_style) bits.push(pa.grade_style);
      if (pa.genre) bits.push(pa.genre);
      return bits.length ? 'Look: ' + bits.join(', ') : '';
    })();
    const tonalLine = pa.tonal_anchors || '';

    // 4. Action / dialogue / heading
    // Narrative action (what's scripted) MUST lead — it's the primary
    // constraint that stops the model from inventing things not in the script.
    // Shot type (ECU, wide, etc.) follows as a modifier.
    const actionDesc = shot.shot_brief?.action || shot.description || shot.action || '';
    const shotType   = shot.shot_brief?.shot   || '';
    const action = actionDesc || shotType ||
                   (shot.prompt && !inFrame.length ? shot.prompt : '') || '';
    const mood = shot.shot_brief?.mood || '';
    const actionLine = [actionDesc || action, shotType, mood].filter(isNonEmpty).join(', ');
    const dialogueLine = shot.dialogue ? `Dialogue: "${shot.dialogue}"` : '';
    const headingLine = heading ? heading + '.' : '';

    // 5. Dispatch to per-model formatter
    const bundle = {
      heading: headingLine,
      charLines,
      charPrimary: charLines[0] || '',
      wardrobeLines,
      action: actionLine,
      framingLine,
      lensLine,
      movementLine,
      lightingLine,
      paletteLine,
      weatherLine,
      tonalLine,
      lookLine,
      dialogueLine,
    };
    const fmt = pickFormatter(model);
    let prompt = fmt(bundle);

    // Always include heading on the front for slate clarity (helps debug
    // generated clips that look weird — the heading is the human-readable
    // "where am I in the script" anchor).
    if (headingLine) prompt = headingLine + ' ' + prompt;

    // 6. Negative prompt (project-level, model-agnostic)
    const negative_prompt = pa.global_negative_prompt ||
      'no text overlays, no watermarks, no captions, no logo, no extra limbs, no deformed hands, no continuity breaks, no unscripted characters, no invented props or objects, no environmental embellishments not described in the scene';

    // 7. Diagnostics (for debugging when shots still look off)
    const diagnostics = {
      model,
      length: prompt.length,
      anchors_used: {
        characters: charAnchorsList.length,
        characters_with_anchors: charAnchorsList.filter(c => isNonEmpty(c.core)).length,
        wardrobe: wardrobeLines.length,
        lighting: !!lightingLine,
        palette: !!paletteLine,
        lens: !!lensLine,
        framing: !!framingLine,
        weather: !!weatherLine,
        look: !!lookLine,
        reference_image: !!character_image_url,
        negative_prompt: !!negative_prompt,
      },
      character_image_url,
    };

    return {
      prompt,
      negative_prompt,
      character_image_url,
      diagnostics,
    };
  }

  // ─── Stage builder (workflow → Media Hub) ───────────────────────────────
  //
  // Workflow's "Open Media Hub" button stages shot data into localStorage.
  // The current stage sends just `prompt: shot_brief.shot + action + mood`
  // — no anchors. This helper builds the full enriched stage payload so
  // Media Hub picks up production-ready prompts.

  function buildStagedShots(project, opts) {
    opts = opts || {};
    const model = opts.model || 'seedance-turbo';
    const shots = project?.shot_list || [];
    return shots.map(sh => {
      const r = enrich(sh, project, { model });
      return {
        id: sh.id,
        prompt: r.prompt,
        negative_prompt: r.negative_prompt,
        character_image_url: r.character_image_url,
        scene_id: sh.scene_id,
        slot: sh.slot,
        duration: sh.duration_target_seconds || 5,
        characters_in_frame: sh.characters_in_frame || [],
        // Carry the diagnostics so Media Hub can show "X anchors locked"
        // indicators per shot if desired.
        _enrichment: r.diagnostics,
      };
    });
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  window.SB_Enricher = {
    enrich,
    buildStagedShots,
    // Exposed for unit tests / debugging
    _internal: {
      characterAnchors,
      sceneAnchors,
      projectAnchors,
      pickFormatter,
    },
  };
})();
