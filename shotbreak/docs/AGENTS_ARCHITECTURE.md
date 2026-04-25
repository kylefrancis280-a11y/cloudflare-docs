# SHOTBREAK Agent System — Architecture

22 AI agents running through the Anthropic API on Kyle's account, structured as a studio org chart. Two orchestrators ("Spielberg-level") direct twenty specialists across four wings. Everything routes through Netlify serverless functions, auth via the existing Firebase Identity Toolkit REST pattern (no Admin SDK — matches SHOTBREAK's Google Cloud org policy constraint).

---

## 1. The 22 Agents

### Orchestrators (2) — `claude-opus-4-7`

| ID | Name | Role | Credits |
|---|---|---|---|
| `auteur` | THE AUTEUR | Director-producer. Takes a brief and returns the full production plan: which specialists to call, in what order, with what inputs. | 50 |
| `showrunner` | THE SHOWRUNNER | Continuity and pacing guardian. Reviews a timeline/assembly and returns a recommended cut: reorder, trim, transition, J/L-cut suggestions. | 50 |

These are the only agents with `canCall: true` — they orchestrate the specialists. They run on Opus 4.7 because the quality of their judgment determines everything downstream.

### Pre-production Wing (6) — `claude-sonnet-4-5-20250929`

| ID | Name | Purpose | Credits |
|---|---|---|---|
| `script-doctor` | Script Doctor | Tightens screenplay beats, fixes dialogue | 15 |
| `scene-architect` | Scene Architect | Breaks a scene into shots with coverage logic | 20 |
| `prompt-smith` | Prompt Smith | Rewrites a shot into an optimal WaveSpeed/Kling/Veo/Hailuo prompt | 5 |
| `character-sculptor` | Character Sculptor | Builds reusable Flux character prompts (consistency-first) | 20 |
| `wardrobe-props` | Wardrobe & Props | Period/genre-accurate costume and prop specs | 15 |
| `location-scout` | Location Scout | Setting descriptions with lighting + atmosphere cues | 15 |

### Cinematography Wing (4) — `claude-sonnet-4-5-20250929`

| ID | Name | Purpose | Credits |
|---|---|---|---|
| `cinematographer` | Cinematographer | Shot list with lens, framing, angle per beat | 15 |
| `lighting-designer` | Lighting Designer | Key/fill/rim plans tied to mood | 15 |
| `color-theorist` | Color Theorist | Palette and LUT direction per scene | 5 |
| `movement-choreographer` | Movement Choreographer | Camera moves + blocking | 5 |

### Post-production Wing (6) — `claude-sonnet-4-5-20250929`

| ID | Name | Purpose | Credits |
|---|---|---|---|
| `editor` | Editor | Timeline-ready cut decisions (JSON output consumed by the editor) | 20 |
| `pacing-doctor` | Pacing Doctor | Flags slow spots, recommends trim lengths | 5 |
| `transition-designer` | Transition Designer | Dissolve/fade/match-cut recommendations | 5 |
| `sound-designer` | Sound Designer | SFX + foley direction per clip | 15 |
| `music-supervisor` | Music Supervisor | Score direction, genre, tempo, cue points | 5 |
| `colorist` | Colorist | Final grade direction | 5 |

### Creative Wing (4) — `claude-sonnet-4-5-20250929`

| ID | Name | Purpose | Credits |
|---|---|---|---|
| `genre-specialist` | Genre Specialist | Genre-convention pass (horror beats, noir framing, etc.) | 5 |
| `continuity-supervisor` | Continuity Supervisor | Catches continuity breaks across shots | 15 |
| `trailer-cutter` | Trailer Cutter | Trailer-length assembly from finished footage | 15 |
| `polish-pass` | Polish Pass | Final editorial polish recommendations | 5 |

**Sum of per-agent credit cost = 325.** (Validates at boot — see `registry.js` sanity test.)

---

## 2. Orchestration Flow

```
┌────────────────────────────────────────────────────────┐
│  USER BRIEF                                            │
│  "Noir short film, 3 min, rainy night, detective..."   │
└────────────────┬───────────────────────────────────────┘
                 │
                 ▼
     ┌───────────────────────┐
     │    THE AUTEUR         │   Opus 4.7 — 50 credits
     │  plans production     │
     └───────────┬───────────┘
                 │  returns: specialist chain + inputs
                 ▼
   ┌─────────────────────────────┐
   │  Specialists run in order   │   Sonnet 4.5 — variable
   │  (context accumulates)      │
   │                             │
   │  Script Doctor →            │
   │  Scene Architect →          │
   │  Cinematographer →          │
   │  Prompt Smith (per shot) →  │
   │  Character Sculptor →       │
   │  ...                        │
   └─────────────┬───────────────┘
                 │  rolling context fed forward
                 ▼
    ┌──────────────────────────┐
    │    THE SHOWRUNNER        │   Opus 4.7 — 50 credits
    │  assembles + QA's the    │   (runs after editing)
    │  timeline                │
    └──────────────────────────┘
```

### Four invocation modes (via `/agent-orchestrate`)

| Mode | Credits | What it does |
|---|---|---|
| `auteur_plan` | 50 | AUTEUR only — returns a specialist execution plan (no specialists run) |
| `showrunner_cut` | 50 | SHOWRUNNER only — takes a timeline, returns cut recommendations |
| `full_production` | 150 | AUTEUR plans → all planned specialists run → SHOWRUNNER reviews |
| `custom_chain` | sum, rounded to nearest valid tier | Caller specifies the chain explicitly |

Single-agent invocation goes through `/agent-invoke` at the agent's own credit cost.

---

## 3. Credit Model

Deductions must be in the set **`[5, 15, 20, 50, 75, 150, 250]`** — this is enforced by the Firestore security rules already in production on SHOTBREAK. The agent system never attempts deductions outside this set.

- Every agent's `credits` value lands in that set exactly.
- Orchestration modes (50, 50, 150) land in that set exactly.
- `custom_chain` sums specialist costs and rounds **up** to the nearest valid tier, so the rules never reject the write.

Owner accounts (Kyle, Scott, Steve — flagged via `window.SB_OWNER_NAME`) bypass credit deduction entirely. Implementation matches the existing owner pattern in `app.html`.

---

## 4. Auth Model

No Firebase Admin SDK. Everything is Identity Toolkit REST.

**Customer path**
1. Frontend sends request with `idToken` (from Firebase Auth JS SDK).
2. Function calls `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=FIREBASE_API_KEY`.
3. Returns `localId` → used as the Firestore doc path `users/{localId}`.
4. Credits read via Firestore REST `GET`, deducted via `commit` with `integerValue` transform.

**Owner path**
1. Frontend sends `owner_name: "Kyle" | "Scott" | "Steve"` instead of `idToken`.
2. Function verifies the name is in the owner whitelist.
3. Skips credit check and deduction.

The three env vars a Netlify deploy needs: `FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID`, `ANTHROPIC_API_KEY`.

---

## 5. Editor Integration

The iMovie-level editor (`/editor/index.html` + `timeline-engine.js`) is the consumer of the post-production wing's output.

- **Editor agent** returns JSON with `clip_id`, `in_point`, `out_point`, `transition`, `track`. `timeline-engine.js` has an `applyRecommendedCut()` method that reads this structure and rewrites the timeline.
- **SHOWRUNNER** runs over the current timeline state (exported via the engine's `exportEDL()`) and returns the same JSON structure. Its recommendations load as a one-click "Apply Showrunner's Cut" button.
- **Pacing Doctor** flags slow spots; the editor highlights them on the timeline ruler.
- **Transition Designer** output maps directly onto `ClipInst.transitionIn.type` and `.duration`.

This means every post-production agent's output is **actionable on the timeline**, not just advisory text.

---

## 6. File Map

```
/agents
  registry.js              Single source of truth — 22 agents, system prompts, credit costs
  client.js                Frontend module → window.SB_Agents

/netlify/functions
  agent-invoke.js          POST: single agent, auth+credits+Anthropic call
  agent-orchestrate.js     POST: 4 modes (auteur_plan, showrunner_cut, full_production, custom_chain)

/editor
  index.html               Dark UI editor — bin, preview, timeline, inspector, AI directors dock
  timeline-engine.js       Data model, playback engine, drag/trim/split, EDL export
```

---

## 7. Design Choices Worth Noting

- **Models split by role, not tier.** Orchestrators get Opus 4.7 because their plans dictate 10x downstream cost. Specialists get Sonnet 4.5 because they run hot and narrow.
- **JSON-first output** for any agent whose output is consumed by code (Editor, Pacing Doctor, Transition Designer, Prompt Smith). Text output only for agents whose product is read by humans (Script Doctor, Location Scout).
- **Rolling context.** `agent-orchestrate.js` accumulates outputs across the chain so later agents see what earlier ones decided. The AUTEUR's plan is always in context.
- **No Admin SDK, ever.** Every privileged operation uses the REST endpoints that already work in SHOTBREAK. The architecture is identical to the video/image generation functions in shape.
- **Credit caps are hard.** The set is `[5, 15, 20, 50, 75, 150, 250]` and nothing negotiates with that.
