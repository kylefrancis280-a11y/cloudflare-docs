/**
 * SHOTBREAK — Tutorial Content
 * ═══════════════════════════════════════════════════════════════════════════
 * All content strings live here so they can be edited without touching engine.
 * Exposed as window.SB_Tours = { tours, walkthroughs, coachmarks, glossary }
 */
(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // TOURS — sequential overlays
  // ─────────────────────────────────────────────────────────────
  const tours = {
    // Homepage intro tour — fires on landing, dismissible, highlights the big claims
    home_intro: {
      name: 'Welcome to SHOTBREAK',
      steps: [
        {
          title: 'The AI film crew.',
          body: `SHOTBREAK is the only AI filmmaking platform with a full <strong>50-agent crew</strong>. Paste a script, and fifteen managers plus thirty-five specialists break it down in under two minutes. This quick tour will show you the pieces.`,
          placement: 'auto',
        },
        {
          title: 'Watch the crew work.',
          body: `On the left, a real script. On the right, your crew. Every row is a real Claude agent. <strong>Done</strong> means their output is in the breakdown. <strong>Live</strong> means they're writing right now. <strong>Queued</strong> means their input isn't ready yet.`,
          target: '.demo-wrap',
          placement: 'bottom',
        },
        {
          title: 'Five wings. Chain of command.',
          body: `Every agent reports to a manager. Every manager owns a wing. The <strong>Vision Director</strong>'s word is law — every one of the 49 downstream agents reads her handoff before writing a single line.`,
          target: '#crew',
          placement: 'bottom',
        },
        {
          title: 'Five stages. One paste.',
          body: `Normalizer strips the script. Directors lock the vision. Builders construct the world. Scene Architect breaks shots. Prompt Smith writes AI-ready prompts. Editors ship it. <strong>~90 seconds end-to-end.</strong>`,
          target: '#how',
          placement: 'bottom',
        },
        {
          title: 'Free on every plan.',
          body: `No per-agent fees. No rationing. No credit meters on the crew itself. Credits are only charged for video and image generation. <strong>Pick a tier and start your trial.</strong>`,
          target: '#pricing',
          placement: 'bottom',
        },
      ],
    },

    // App dashboard — fires first time user lands on /app.html
    app_onboarding: {
      name: 'Your studio',
      steps: [
        {
          title: 'This is your studio.',
          body: `Every film you make lives here. Click any project to pick up where you left off. New projects start with a single click.`,
        },
        {
          title: 'Start a project.',
          body: `Click this banner. You'll name it, paste your script if you have one, and meet the 50-agent crew. No forms, no drop-downs.`,
          target: 'a[href="/workflow/"]',
          placement: 'bottom',
        },
        {
          title: 'Your projects land here.',
          body: `Once you've created a project, every one shows up in this list with its current step. Click any card to resume exactly where you left off.`,
          target: '#dashProjectsWrap',
          placement: 'bottom',
        },
        {
          title: 'Help lives in the corner.',
          body: `The gold <strong>?</strong> button, bottom-right, opens the help menu. Replay any tour, watch the full walkthrough, or jump to the docs.`,
          target: '.sb-help-fab',
          placement: 'auto',
        },
      ],
    },

    // Workflow drop-in — adjusted for actual create-card DOM
    workflow_dropin: {
      name: 'Script Drop-In',
      steps: [
        {
          title: 'Name the project. Paste the script.',
          body: `The two fields above are it. Name is required — the script is optional and you can paste it now or in the Vision step.`,
          target: '#create-card',
          placement: 'bottom',
        },
        {
          title: 'Then hit Create.',
          body: `Your project is saved. The <strong>Vision Director</strong> takes first read, then the rest of the 50-agent crew follows.`,
          target: '#np-create',
          placement: 'auto',
        },
        {
          title: 'Every existing project is below.',
          body: `Once you have projects, they show up here sorted by recency. Click to jump straight back to the step you left.`,
        },
        {
          title: 'Everything is editable.',
          body: `After the crew runs, <strong>every field in the breakdown is a text input.</strong> Rename a character, rewrite a shot, swap a location — only the affected agents re-run.`,
        },
      ],
    },
  };

  // ─────────────────────────────────────────────────────────────
  // COACHMARKS — persistent gold dots, click for popover
  // ─────────────────────────────────────────────────────────────
  // Keyed by page context. Call SB_Tutorial.installCoachmarks(SB_Tours.coachmarks.home)
  // after DOM ready.
  const coachmarks = {
    home: [
      {
        id: 'hero_claim',
        selector: 'h1.hero-title',
        title: '90 seconds, end-to-end',
        body: `For a 10-page script: Directors take ~10s, Builders fan out in ~25s, Scene Architect + Prompt Smith take ~40s, Editors wrap in ~15s. Most work runs in parallel.`,
      },
      {
        id: 'crew_count',
        selector: '.stat-num',
        title: 'Why 50?',
        body: `15 managers (Claude Opus) orchestrate. 35 specialists (Claude Sonnet) execute. The split isn't arbitrary — it matches how a real production is organized.`,
      },
      {
        id: 'demo_script',
        selector: '#script-pane',
        title: 'This is a real script',
        body: `Not a mockup. The demo runs the same crew your subscription runs. The sodium-lit warehouse scene is what you'd see in the output.`,
      },
      {
        id: 'pricing_all_agents',
        selector: '.tier-features li:first-child',
        title: 'Agents are free',
        body: `"All 50 agents, unlimited runs" is on every tier. Credits only apply to video/image generation (WaveSpeed, Flux). The crew itself has no meter.`,
      },
    ],
    app: [
      {
        id: 'start_project',
        selector: 'a[href="/workflow/"]',
        title: 'Start here',
        body: `Click to name your project and paste your script. The 50-agent crew takes it from there.`,
      },
      {
        id: 'projects_list',
        selector: '#dashProjectsWrap',
        title: 'Your projects',
        body: `Every project you create shows up here sorted by last edit. Click any card to resume.`,
      },
    ],
    workflow: [
      {
        id: 'create_name',
        selector: '#np-title',
        title: 'Name it anything',
        body: `Required. Call it whatever helps you remember — "Dispatch short", "Pier 9 scene", "Test 1". You can change it later in the Vision step.`,
      },
      {
        id: 'create_script',
        selector: '#np-script',
        title: 'Paste if you have one',
        body: `Optional. Any format: Fountain, Final Draft paste, Google Doc paste, raw text with scene slugs. The Script Normalizer strips junk before the crew reads it.`,
      },
    ],
  };

  // ─────────────────────────────────────────────────────────────
  // WALKTHROUGH — animated demo with narration
  // Script paste → Vision Director → Builders → Scene Architect → Prompt Smith → Editors ship
  // ─────────────────────────────────────────────────────────────

  // Demo stage renderers — each returns HTML for the stage area
  function scriptStage() {
    return `
      <div class="sb-demo-split">
        <div>
          <div class="sb-demo-crew-title">· Script · input ·</div>
          <pre class="sb-demo-script"><span class="slug">INT. DETECTIVE OFFICE — NIGHT</span>

Rain streaks the window. MAYA CHEN (40s,
sharp, exhausted) stands over a desk
buried in case files.

                <span class="char">MAYA</span>
You're three hours late.

                <span class="char">DANE</span>
                  (breathless)
I found him. Warehouse on Pier 9.</pre>
        </div>
      </div>
    `;
  }

  function crewStage(rows) {
    return `
      <div class="sb-demo-split">
        <div class="sb-demo-crew">
          <div class="sb-demo-crew-title">· Crew · working ·</div>
          ${rows.map(r => `
            <div class="sb-demo-crew-row">
              <span class="sb-demo-status ${r.status}">${r.status === 'working' ? '<span class="sb-demo-spinner"></span> live' : r.status === 'done' ? '✓ done' : 'queued'}</span>
              <span class="sb-demo-crew-name ${r.spec ? 'spec' : ''}">${r.spec ? '↳ ' : ''}${r.name}</span>
              <span class="sb-demo-crew-detail">${r.detail || ''}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function outputStage() {
    return `
      <div class="sb-demo-split">
        <div style="max-width: 480px;">
          <div class="sb-demo-crew-title">· Breakdown · excerpt ·</div>
          <pre class="sb-demo-script" style="font-size: 11.5px;">shot sh_003 · scene sc_001 · CU

<span class="char">PROMPT</span>
Close-up, 85mm, Maya's face half-lit
by a sodium street lamp through the
rain-streaked window. Neo-noir
palette — muted amber and deep blue.
Handheld, slight drift. Exhaustion
cracking the composure. 5s.

<span class="char">CHARACTERS</span>
- Maya Chen (canonical v1)

<span class="char">NEGATIVE</span>
no multiple figures, no camera pan,
no daylight, no warm highlights

<span class="char">MODEL</span>
seedance-turbo · 1024x1024 · 5s</pre>
        </div>
      </div>
    `;
  }

  const walkthroughs = {
    script_to_breakdown: {
      name: 'The 90-second breakdown',
      steps: [
        {
          title: 'A script arrives.',
          body: `The client pastes a two-page scene into the Script Drop-In. The <strong>Script Normalizer</strong> runs instantly — strips page numbers, revision marks, CONTINUEDs. It's deterministic, no API cost, and happens before any agent sees the text.`,
          stage: scriptStage,
          durationMs: 5000,
        },
        {
          title: 'Stage 1 — Directors lock the vision.',
          body: `Three managers run in parallel. <strong>Vision Director</strong> sets tone ("neo-noir, sodium-lit"), palette, and pacing contract. <strong>Story Director</strong> maps beats. <strong>Visual Director</strong> writes the visual grammar. Takes about 10 seconds.`,
          stage: () => crewStage([
            { status: 'working', name: 'Vision Director', detail: 'tone · palette' },
            { status: 'working', name: 'Story Director',  detail: 'beat map' },
            { status: 'working', name: 'Visual Director', detail: 'grammar' },
            { status: 'queued',  name: 'Visual Character Builder' },
            { status: 'queued',  name: 'Environment Builder' },
            { status: 'queued',  name: 'Prompt Writer' },
          ]),
          durationMs: 6000,
        },
        {
          title: 'Stage 2 — Builders fan out.',
          body: `With the vision locked, nine builders fan out in parallel. <strong>Visual Character Builder</strong> sculpts Maya and Dane. <strong>Environment Builder</strong> designs the office. <strong>Atmospherics</strong> handles the rain, the sodium lamp, the buzz. ~25 seconds.`,
          stage: () => crewStage([
            { status: 'done',    name: 'Vision Director' },
            { status: 'done',    name: 'Story Director' },
            { status: 'done',    name: 'Visual Director' },
            { status: 'working', name: 'Visual Character Builder', detail: '2 chars' },
            { status: 'working', name: 'Character Sculptor', spec: true, detail: 'Maya' },
            { status: 'working', name: 'Wardrobe & Props',   spec: true, detail: 'locked' },
            { status: 'working', name: 'Environment Builder', detail: 'office · pier' },
            { status: 'working', name: 'Location Scout', spec: true, detail: 'fog · sodium' },
            { status: 'working', name: 'Atmospherics Builder', detail: 'rain · lamp' },
          ]),
          durationMs: 6500,
        },
        {
          title: 'Stage 3 — Scene Architect breaks shots.',
          body: `Now the <strong>Scene Architect</strong> breaks every scene into 3-6 shots with coverage logic (master, coverage, reaction, insert). For each shot, <strong>Prompt Smith</strong> writes the final AI-ready prompt. The character bible and location library are used by reference.`,
          stage: () => crewStage([
            { status: 'done',    name: 'All builders' },
            { status: 'working', name: 'Scene Architect', detail: 'sc_001 · sc_002' },
            { status: 'working', name: 'Prompt Smith', spec: true, detail: 'shot 17 / 47' },
            { status: 'working', name: 'Shot Calibrator', spec: true, detail: 'per-model' },
            { status: 'queued',  name: 'Continuity Supervisor' },
            { status: 'queued',  name: 'Assembly Editor' },
          ]),
          durationMs: 6500,
        },
        {
          title: 'Stage 4 — Editors ship.',
          body: `<strong>Continuity Supervisor</strong> checks for wardrobe and prop drift across scenes. <strong>Pacing Doctor</strong> compares estimated runtime to the pacing contract. <strong>Assembly Editor</strong> issues the ship verdict. If anything's red, the relevant specialist gets a rerun request.`,
          stage: () => crewStage([
            { status: 'done',    name: 'All builders, all shots' },
            { status: 'working', name: 'Continuity Supervisor', detail: '2 warnings' },
            { status: 'working', name: 'Pacing Doctor', detail: '00:42 vs 00:40 target' },
            { status: 'working', name: 'Assembly Editor', detail: 'ship verdict' },
          ]),
          durationMs: 6000,
        },
        {
          title: 'The breakdown is ready.',
          body: `Every shot has an AI-ready prompt. Every character has a canonical description reused across generations. Every scene has lighting notes, location specs, sound direction. <strong>You scroll through and edit what you want.</strong> The rest is already done.`,
          stage: outputStage,
          durationMs: 8000,
        },
      ],
    },
  };

  // ─────────────────────────────────────────────────────────────
  // GLOSSARY — every one of the 50 agents, described in one paragraph
  // Used by /learn/ for a searchable reference
  // ─────────────────────────────────────────────────────────────
  const glossary = [
    // TIER 1 — MANAGERS (15)
    { id: 'vision-director', tier: 1, wing: 'Directors', name: 'The Vision Director',
      summary: `The first agent to touch a project. Reads your logline, genre, references, and target length, then writes the vision statement that every other agent is bound to. Locks the palette, pacing contract, lens language, and continuity rules. Her word is law.` },
    { id: 'story-director', tier: 1, wing: 'Directors', name: 'The Story Director',
      summary: `Owns narrative structure. Reads the normalized script plus the vision, maps every scene to a story beat (setup, inciting, turn, midpoint, crisis, climax, resolution), and flags cause-and-effect gaps. Issues a structure verdict: sound, fixable, or rewrite_needed.` },
    { id: 'visual-director', tier: 1, wing: 'Directors', name: 'The Visual Director',
      summary: `Owns the look. Writes the visual grammar: dominant lens range, framing principles, movement philosophy, composition rules. Directs four specialists — Cinematographer, Movement Choreographer, Color Theorist, Colorist — to execute that grammar per shot.` },
    { id: 'dialogue-writer', tier: 1, wing: 'Script Writers', name: 'The Dialogue Writer',
      summary: `Runs the dialogue desk. Scores voice distinctness per character, produces top rewrite candidates, delegates cliche-hunting to her specialists. Every line earns its place; every character sounds like no one else.` },
    { id: 'action-writer', tier: 1, wing: 'Script Writers', name: 'The Action Writer',
      summary: `Owns everything on the script page that isn't dialogue: action prose, scene headings, transitions, parentheticals, subtext. Delegates tightening to Script Doctor, formatting to Script Formatter, subtext enrichment to Subtext Writer.` },
    { id: 'prompt-writer', tier: 1, wing: 'Script Writers', name: 'The Prompt Writer',
      summary: `The bridge between the script and the AI video models. Every shot your crew ever produces passes through her desk. Sets the prompt strategy, chooses the default model, and issues global negative prompts. Directs Prompt Smith, Scene Architect, and Shot Calibrator.` },
    { id: 'visual-character-builder', tier: 1, wing: 'Characters', name: 'The Visual Character Builder',
      summary: `Eliminates the #1 problem in AI filmmaking: characters drifting between shots. Produces the character bible — canonical descriptions, signature wardrobe, signature props, consistency rules — that every downstream generation reads by reference.` },
    { id: 'psychological-builder', tier: 1, wing: 'Characters', name: 'The Psychological Builder',
      summary: `Gives every named character a psychology: core wound, desire, obstacle, arc trajectory, moral flaw. Characters with no inner life generate flat footage. Directs the Emotion Mapper.` },
    { id: 'voice-builder', tier: 1, wing: 'Characters', name: 'The Voice Builder',
      summary: `Defines how each character speaks — vocabulary register, sentence length, contractions, signature patterns, things they'd never say. Directs the Voice Consistency Auditor and ADR Supervisor.` },
    { id: 'environment-builder', tier: 1, wing: 'Settings', name: 'The Environment Builder',
      summary: `Builds every physical location — scale, architecture, materials, weathering, geographic context. Produces the location_library entry used by the Scene Architect for establishing shots. Directs Location Scout and Architecture Designer.` },
    { id: 'atmospherics-builder', tier: 1, wing: 'Settings', name: 'The Atmospherics Builder',
      summary: `Layers in light, weather, time of day, and sound texture per scene. A location without atmosphere is a diorama — this manager makes every location feel lived in. Directs Lighting Designer, Weather Coordinator, Sound Designer.` },
    { id: 'dressing-builder', tier: 1, wing: 'Settings', name: 'The Dressing Builder',
      summary: `Fills the built, lit space with objects. What's on the desk, what's on the walls, what characters touch. Worldbuilding through dressing. Directs Props Master, Set Dresser, VFX Supervisor.` },
    { id: 'timeline-editor', tier: 1, wing: 'Editors', name: 'The Timeline Editor',
      summary: `Runs the cutting room. Decides clip order, trim strategy (lean / breathing / luxuriant), and the flow of the cut. Directs Editor and Transition Designer.` },
    { id: 'pacing-editor', tier: 1, wing: 'Editors', name: 'The Pacing Editor',
      summary: `Matches the film's heartbeat to the Vision Director's pacing contract. Declares breathing beats and acceleration beats. Directs Pacing Doctor and Runtime Calculator.` },
    { id: 'assembly-editor', tier: 1, wing: 'Editors', name: 'The Assembly Editor',
      summary: `The last manager before delivery. Issues the ship verdict (ship / revise / reject), runs the final polish checklist, commissions the trailer, sets music direction. Directs Trailer Cutter, Polish Pass, Music Supervisor.` },

    // TIER 2 — SPECIALISTS (35)
    { id: 'genre-specialist', tier: 2, wing: 'Directors', name: 'Genre Specialist',
      summary: `Names 5-8 genre conventions to honor and 3-5 to subvert. Returns visual motifs, sonic motifs, and a list of tropes to avoid. Reports to Vision Director.` },
    { id: 'beat-analyst', tier: 2, wing: 'Directors', name: 'Beat Analyst',
      summary: `Maps every scene to a story beat (setup, inciting, turn, midpoint, crisis, climax, resolution, connective) and flags missing beats. Reports to Story Director.` },
    { id: 'continuity-supervisor', tier: 2, wing: 'Directors', name: 'Continuity Supervisor',
      summary: `Scans the shot list, character bible, and location library for continuity breaks — wardrobe drift, prop disappearances, character presence mismatches, time inconsistencies. Returns warnings with severity. Reports to Story Director.` },
    { id: 'cinematographer', tier: 2, wing: 'Directors', name: 'Cinematographer',
      summary: `Builds shot lists with lens, framing, angle, and duration per beat. Finds missing coverage. Reports to Visual Director.` },
    { id: 'movement-choreographer', tier: 2, wing: 'Directors', name: 'Movement Choreographer',
      summary: `Assigns camera motion per shot — static, handheld, dolly, pan, tilt, whip, crane — tied to the pacing contract. Reports to Visual Director.` },
    { id: 'color-theorist', tier: 2, wing: 'Directors', name: 'Color Theorist',
      summary: `Sets master palette and per-scene palette deltas in hex, with a rationale for each drift. Reports to Visual Director.` },
    { id: 'colorist', tier: 2, wing: 'Directors', name: 'Colorist',
      summary: `Writes final grade notes per scene — highlight lift, shadow lift, saturation — plus reference films for the overall look. Reports to Visual Director.` },
    { id: 'dialogue-coach', tier: 2, wing: 'Script Writers', name: 'Dialogue Coach',
      summary: `Line-by-line rewrites for dialogue. Scores voice distinctness per character with specific notes. Reports to Dialogue Writer.` },
    { id: 'cliche-detector', tier: 2, wing: 'Script Writers', name: 'Cliche Detector',
      summary: `Flags on-the-nose lines, stock phrases, genre cliches with suggested alternatives. Reports to Dialogue Writer.` },
    { id: 'script-doctor', tier: 2, wing: 'Script Writers', name: 'Script Doctor',
      summary: `Tightens screenplay beats and action lines while preserving voice. Returns revised scenes with cut percentages. Reports to Action Writer.` },
    { id: 'script-formatter', tier: 2, wing: 'Script Writers', name: 'Script Formatter',
      summary: `Industry-standard screenplay format polish — capitalization, slug spacing, character cue alignment. Structural only, no content changes. Reports to Action Writer.` },
    { id: 'subtext-writer', tier: 2, wing: 'Script Writers', name: 'Subtext Writer',
      summary: `Layers in what isn't said but is felt. Tags the subtextual intent of every scene, adds character undertones, inserts action lines and parentheticals that carry the subtext. Reports to Action Writer.` },
    { id: 'prompt-smith', tier: 2, wing: 'Script Writers', name: 'Prompt Smith',
      summary: `The workhorse. Rewrites each shot into an optimized AI video-generation prompt — final prompt, negative prompt, character refs used, target model. Called per shot, potentially hundreds of times per project. Reports to Prompt Writer.` },
    { id: 'scene-architect', tier: 2, wing: 'Script Writers', name: 'Scene Architect',
      summary: `Breaks each scene into 3-6 shots with coverage logic (master, coverage, reaction, insert, OTS, wide). Specifies slot, action, mood, duration, and characters in frame. Reports to Prompt Writer.` },
    { id: 'shot-calibrator', tier: 2, wing: 'Script Writers', name: 'Shot Calibrator',
      summary: `Tunes a prompt for a specific video model's quirks. Produces per-model variants for Seedance Turbo, Kling 3, Veo 3, and Hailuo. Reports to Prompt Writer.` },
    { id: 'character-sculptor', tier: 2, wing: 'Characters', name: 'Character Sculptor',
      summary: `Produces the canonical 50-word character description used by every image and video generation. Also emits visual anchors and a consistency phrase repeated verbatim in every prompt. Reports to Visual Character Builder.` },
    { id: 'wardrobe-props', tier: 2, wing: 'Characters', name: 'Wardrobe & Props',
      summary: `Assigns signature wardrobe and hand props per character, with scene-specific overrides when the story requires. Reports to Visual Character Builder.` },
    { id: 'emotion-mapper', tier: 2, wing: 'Characters', name: 'Emotion Mapper',
      summary: `Per-scene, per-character emotional state with intensity and visible signs. Builds the emotional curve of the film. Reports to Psychological Builder.` },
    { id: 'voice-consistency-auditor', tier: 2, wing: 'Characters', name: 'Voice Consistency Auditor',
      summary: `Scans every line of dialogue against the character's voice signature. Flags mismatches with suggested rewrites. Reports to Voice Builder.` },
    { id: 'adr-supervisor', tier: 2, wing: 'Characters', name: 'ADR Supervisor',
      summary: `Flags dialogue that will need re-recording — background noise conflicts, performance issues, known model limitations. Reports to Voice Builder.` },
    { id: 'location-scout', tier: 2, wing: 'Settings', name: 'Location Scout',
      summary: `Elaborates each setting into a paragraph for generation — establishing prompt, sensory anchors. Reports to Environment Builder.` },
    { id: 'architecture-designer', tier: 2, wing: 'Settings', name: 'Architecture Designer',
      summary: `Structural specifics per location — building type, era, primary materials, scale in human terms. Reports to Environment Builder.` },
    { id: 'lighting-designer', tier: 2, wing: 'Settings', name: 'Lighting Designer',
      summary: `Key/fill/rim lighting plan per scene, with motivated source and mood notes. Reports to Atmospherics Builder.` },
    { id: 'weather-coordinator', tier: 2, wing: 'Settings', name: 'Weather Coordinator',
      summary: `Time of day, weather, wind, air quality, temperature feel per scene. Reports to Atmospherics Builder.` },
    { id: 'sound-designer', tier: 2, wing: 'Settings', name: 'Sound Designer',
      summary: `SFX and foley direction per shot, plus room tone and signature sounds. Reports to Atmospherics Builder.` },
    { id: 'props-master', tier: 2, wing: 'Settings', name: 'Props Master',
      summary: `Hand props characters interact with per scene, with significance notes. Reports to Dressing Builder.` },
    { id: 'set-dresser', tier: 2, wing: 'Settings', name: 'Set Dresser',
      summary: `What's on the walls, on the surfaces, in the space. Worldbuilding hooks — objects that reveal character. Reports to Dressing Builder.` },
    { id: 'vfx-supervisor', tier: 2, wing: 'Settings', name: 'VFX Supervisor',
      summary: `Identifies shots that need VFX plates, compositing, particle work, cleanup, or mattes. Returns specs and complexity. Reports to Dressing Builder.` },
    { id: 'editor', tier: 2, wing: 'Editors', name: 'Editor',
      summary: `Per-clip cut decisions — trim_start, trim_end, reorder, remove, split. Reports to Timeline Editor.` },
    { id: 'transition-designer', tier: 2, wing: 'Editors', name: 'Transition Designer',
      summary: `Recommends transitions between every pair of clips — hard_cut, dissolve, fade, match_cut, j_cut, l_cut — with duration in frames and reason. Reports to Timeline Editor.` },
    { id: 'pacing-doctor', tier: 2, wing: 'Editors', name: 'Pacing Doctor',
      summary: `Flags slow or rushed sections against the pacing contract, with suggested fixes. Reports to Pacing Editor.` },
    { id: 'runtime-calculator', tier: 2, wing: 'Editors', name: 'Runtime Calculator',
      summary: `Estimates per-scene and total runtime from action density and dialogue count. Reports to Pacing Editor.` },
    { id: 'trailer-cutter', tier: 2, wing: 'Editors', name: 'Trailer Cutter',
      summary: `Proposes a 60-second trailer structure with music cues and a hook moment. Reports to Assembly Editor.` },
    { id: 'polish-pass', tier: 2, wing: 'Editors', name: 'Polish Pass',
      summary: `Final checklist before export — continuity, pacing, color, audio, coverage, dialogue, VFX. Returns a ship recommendation. Reports to Assembly Editor.` },
    { id: 'music-supervisor', tier: 2, wing: 'Editors', name: 'Music Supervisor',
      summary: `Score direction — genre, BPM range, cue points aligned to the emotional curve. Reports to Assembly Editor.` },
  ];

  window.SB_Tours = { tours, walkthroughs, coachmarks, glossary };
})();
