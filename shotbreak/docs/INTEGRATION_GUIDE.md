# SHOTBREAK Agent System — Integration Guide

Drop-in guide for wiring the 22-agent system + iMovie-level editor into the existing SHOTBREAK Netlify/Firebase deploy. Written assuming the existing SHOTBREAK codebase layout (app.html at root, `/.netlify/functions/` for serverless, Firebase project `shotbreak-9f342`).

---

## Step 1 — Copy files into the repo

```
shotbreak/
├── agents/
│   ├── registry.js          ← copy from this bundle
│   └── client.js            ← copy from this bundle
├── netlify/
│   └── functions/
│       ├── agent-invoke.js       ← copy
│       └── agent-orchestrate.js  ← copy
├── editor/
│   ├── index.html           ← copy
│   └── timeline-engine.js   ← copy
└── app.html                 ← existing (needs a single script tag — see Step 3)
```

`registry.js` is shared — the serverless functions `require` it at runtime, and `client.js` mirrors the agent metadata for the UI. Don't split them.

---

## Step 2 — Environment variables on Netlify

Add to **Site settings → Environment variables**:

| Key | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Kyle's Anthropic API key (sk-ant-...) |
| `FIREBASE_API_KEY` | Already set in SHOTBREAK — reuse |
| `FIREBASE_PROJECT_ID` | `shotbreak-9f342` — already set, reuse |

No new service accounts. No Admin SDK. The functions use the same Identity Toolkit REST pattern as the existing video generation functions.

---

## Step 3 — Wire the frontend client into app.html

In `app.html`, near the bottom of `<body>` alongside the existing SHOTBREAK scripts, add:

```html
<script src="/agents/client.js"></script>
```

This registers `window.SB_Agents` with these methods:

```js
window.SB_Agents.invoke(agentId, input, { context })    // single agent
window.SB_Agents.auteurPlan(brief)                       // 50 credits
window.SB_Agents.showrunnerCut(timelineExport)           // 50 credits
window.SB_Agents.fullProduction(brief)                   // 150 credits
window.SB_Agents.customChain(input, ["script-doctor", "scene-architect", ...])
window.SB_Agents.agents()                                // list all 22
window.SB_Agents.agentsByWing("pre-production")          // filtered
window.SB_Agents.agentMeta("prompt-smith")               // single agent info for UI
```

The client auto-detects auth. If `window.SB_OWNER_NAME` is set (existing owner login path), it sends `owner_name`. Otherwise it reads the Firebase Auth idToken from the current user.

---

## Step 4 — Expose generated clips to the editor

The editor reads generated media from `window.SB_Generated` — an array of objects:

```js
window.SB_Generated = [
  {
    id: "gen_abc123",
    name: "Detective walks in rain",
    src: "https://fal.media/files/.../clip.mp4",  // or WaveSpeed URL
    duration: 5.0,
    thumb: "data:image/jpeg;base64,..."  // optional; engine will auto-generate if missing
  },
  ...
];
```

After a WaveSpeed or fal.ai generation completes in app.html, push the result onto `window.SB_Generated`. When the editor loads (or when the user clicks "Refresh from Generations" in the bin), it pulls from this array.

**Minimal change** — wherever SHOTBREAK currently stores the completed video URL after a WaveSpeed job, also push:

```js
window.SB_Generated = window.SB_Generated || [];
window.SB_Generated.push({
  id: jobId,
  name: promptSummary,
  src: videoUrl,
  duration: videoDurationSeconds
});
```

That's it. The editor handles thumbnail generation via the canvas API.

---

## Step 5 — Add /editor as a route

On Netlify this is automatic — `editor/index.html` deploys to `/editor/`. No config needed unless you want a cleaner URL, in which case add to `netlify.toml`:

```toml
[[redirects]]
  from = "/edit"
  to = "/editor/index.html"
  status = 200
```

Link to it from app.html with a simple anchor: `<a href="/editor/">Open Editor</a>`. The editor reads `window.SB_Generated` on load, so make sure app.html has populated it (or have the editor open in the same tab so the array is preserved).

> **Tip:** If you want the editor to open in the same window and preserve the generated clips array, use a standard link, not `window.open()`. The generated array lives on `window` and won't cross a new tab.

---

## Step 6 — Server-side render endpoint (extension point)

The editor's "Render" button posts the EDL to `/.netlify/functions/render-timeline`. **This function is not included** — it's the render pipeline extension point.

When you're ready to build it, the EDL it receives looks like:

```json
{
  "version": 1,
  "clips": [
    {
      "id": "ci_1",
      "src": "https://...",
      "track": "V1",
      "start": 0,
      "sourceIn": 0.5,
      "sourceOut": 4.5,
      "transitionIn": { "type": "dissolve", "duration": 0.5 }
    },
    ...
  ],
  "duration": 180.0
}
```

Two implementation paths:
- **Cloud render service** (Shotstack, Creatomate, or Remotion Lambda). Cleanest — just forward the EDL. ~$0.02–0.05 per second of output.
- **ffmpeg on a container** (not Netlify — use Fly.io or a Lambda with ffmpeg layer). More work, cheaper at scale.

Until the render endpoint exists, the button shows a "coming soon" message — no broken state.

---

## Step 7 — Firestore security rules (no changes needed)

The existing SHOTBREAK rules already:
- Lock `credits` to server-only modification ✓
- Permit integer deductions from the set `[5, 15, 20, 50, 75, 150, 250]` ✓

The agent functions deduct only values in that set. No rule changes required.

---

## Step 8 — Test checklist

Before announcing the update:

1. **Owner login works.** Sign in as Kyle → call `SB_Agents.invoke("prompt-smith", "a lonely detective")` from the console → returns prompt, no credit deduction.
2. **Customer login works.** Fresh test account at Creator tier → same call → returns prompt, deducts 5 credits.
3. **Full production runs.** Customer account → `SB_Agents.fullProduction("3-min noir short, rainy night")` → deducts 150, returns AUTEUR plan + specialist outputs + SHOWRUNNER review.
4. **Editor loads a generated clip.** In app.html, trigger a WaveSpeed gen → open `/editor/` → clip appears in Media Bin → drag to timeline → plays back.
5. **Trim, split, reorder work.** Drag clip → grab edge handles → trim → press S to split at playhead → drag around the timeline.
6. **Showrunner cut applies.** Click "Ask Showrunner" in the AI Directors dock → returns cut JSON → "Apply" updates timeline.
7. **EDL export works.** Click Export → downloads a JSON file with the full timeline state.
8. **Error paths don't spend credits.** Anthropic API failure should refund (or never deduct) — verify by forcing a bad API key temporarily.

---

## Caveats and gotchas (worth calling out)

- **No Admin SDK.** Every operation is REST. If you see Admin SDK imports creep in during future edits, reject them — it will break on the org policy.
- **Credit amounts are hardcoded.** If you want to change pricing, the set `[5, 15, 20, 50, 75, 150, 250]` must be updated in **both** `registry.js` (source of truth) **and** the Firestore security rules. Miss one and writes will silently reject.
- **Video generation runs on WaveSpeed, not fal.ai.** The editor doesn't care — it just needs URLs in `window.SB_Generated`. But if any agent prompt mentions fal.ai for video, fix it (`Prompt Smith` is the one to audit first).
- **Opus 4.7 is the orchestrator model.** If Anthropic renames or deprecates it, update `registry.js` — both `auteur` and `showrunner` reference `claude-opus-4-7` directly.
- **The editor's thumbnail generation** runs client-side via `<video>` + canvas. First-time load of a long clip can take a second or two. It's non-blocking but worth knowing.
- **Inspector IDs are dynamic.** A static code scan will flag 8 IDs in `timeline-engine.js` as "missing from HTML" (e.g., `insp-delete`, `insp-split`). They're created at runtime by `renderInspector()` when a clip is selected. Not a bug.

---

## One-liner summary for the team

> SHOTBREAK now has a 22-agent AI studio (2 Opus orchestrators + 20 Sonnet specialists) and a browser-based iMovie-level timeline editor. Auth + credits reuse the existing Firebase REST pattern. Drop files in, set `ANTHROPIC_API_KEY`, link `/editor/` from app.html, and push generated clips onto `window.SB_Generated`.
