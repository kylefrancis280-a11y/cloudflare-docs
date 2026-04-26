# SHOTBREAK

AI film production crew. 50 agents break down a screenplay in parallel — 90 seconds from logline to full production package.

## Architecture

```
Browser (app.html / workflow/)
  └── agents/client.js          SB_Agents — single API surface for all agent calls
  └── agents/registry.js        50 agent definitions (ids, prompts, credit costs)
  └── agents/normalizers.js     Input preprocessing before every agent call
  └── agents/appliers.js        Output merging back into the project object
  └── agents/prompt_enricher.js Context enrichment (genre tags, tone, etc.)

Netlify Functions
  ├── agent-invoke.js            Sync agent call (26s budget) — returns output directly
  ├── agent-invoke-background.js Async agent call (15min budget) — returns 202, writes to Firestore
  ├── agent-invoke-status.js     Poll status of a background job
  ├── agent-orchestrate.js       Multi-agent modes: auteur_plan, full_production, full_crew
  ├── bootstrap-user.js          Idempotent user-doc creation on first sign-in
  ├── generate-video.js          WaveSpeed (Seedance) video generation
  ├── generate-character.js      fal.ai (Flux) character image generation
  ├── stripe-webhook.js          Stripe payment events → tier upgrades
  ├── verify-owner.js            Legacy HMAC owner token issuance
  └── lib/auth.js                Shared: Firebase token verify, Firestore user helpers

Backend
  ├── Firebase Auth              User authentication (email/password + Google)
  ├── Firestore (REST API)       User docs (tier, credits), agent_jobs
  ├── Anthropic Claude           claude-sonnet-4-5 → claude-haiku-4-5 fallback
  ├── WaveSpeed                  Video generation (Seedance Turbo / Veo 3.1)
  ├── fal.ai                     Character image generation (Flux Schnell/Dev/Pro)
  └── Stripe                     Subscriptions (creator / studio / production / enterprise)
```

## Environment Variables

Set these in Netlify → Site settings → Environment variables.

| Variable | Description |
|---|---|
| `FIREBASE_API_KEY` | Firebase web API key (from Firebase Console → Project settings) |
| `FIREBASE_PROJECT_ID` | Firebase project ID (e.g. `shotbreak-prod`) |
| `SYSTEM_EMAIL` | Service account email for Firestore REST calls |
| `SYSTEM_PASSWORD` | Service account password |
| `OWNER_EMAILS` | Comma-separated list of owner emails (get free unlimited access) |
| `OWNER_TOKEN_SECRET` | 48+ char secret for legacy HMAC owner tokens |
| `OWNER_PW_KYLE` | Password for owner `kyle` (verify-owner endpoint) |
| `ANTHROPIC_API_KEY` | Anthropic API key (`sk-ant-...`) |
| `WAVESPEED_API_KEY` | WaveSpeed API key for video generation |
| `FAL_KEY` | fal.ai API key for character image generation |
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (`whsec_...`) |

## Netlify Configuration

`netlify.toml` configures:
- Functions directory: `netlify/functions`
- Publish directory: `.` (serves static files from shotbreak root)
- Node 20 runtime

`_headers` sets:
- CSP, X-Frame-Options, X-Content-Type-Options globally
- COEP/COOP on `/app.html`, `/editor/*`, `/workflow/*` (required for FFmpeg.wasm SharedArrayBuffer)
- Immutable cache on `/static/ffmpeg/*`, no-cache on HTML/JS/CSS

## Deployment

1. Push to the branch connected to your Netlify site
2. Netlify auto-deploys on push
3. Set all env vars above in Netlify dashboard
4. Configure Stripe webhook: `https://shotbreak.io/.netlify/functions/stripe-webhook` → all checkout + subscription + invoice events
5. Verify `shotbreak.io` DNS in Netlify → Domains

## Functions Reference

### `POST /.netlify/functions/bootstrap-user`
Create Firestore user doc on first login. Idempotent — safe to call on every sign-in.
- **Auth**: Firebase idToken in `Authorization: Bearer <token>` header
- **Returns**: `{ uid, email, tier, credits, isOwner }`

### `POST /.netlify/functions/agent-invoke`
Synchronous agent call. Times out at 26s (Netlify sync limit).
- **Auth**: Firebase idToken or HMAC owner token
- **Body**: `{ agent_id, input, context? }`
- **Returns**: `{ ok, output, credits_charged, is_owner, model_used, usage }`

### `POST /.netlify/functions/agent-invoke-background`
Async agent call — runs up to 15 minutes. Client receives 202 immediately.
- **Auth**: Firebase idToken
- **Body**: `{ agent_id, input, context?, job_id }` — generate `job_id` client-side with `crypto.randomUUID()`
- **Returns**: 202 (Netlify) — result written to Firestore `agent_jobs/${uid}_${job_id}`

### `GET /.netlify/functions/agent-invoke-status?job=JOB_ID`
Poll background job status.
- **Auth**: Firebase idToken
- **Returns**: `{ status: 'pending' | 'running' | 'complete' | 'error', output?, error?, credits_charged? }`

### `POST /.netlify/functions/agent-orchestrate`
Multi-agent pipeline.
- **Body**: `{ mode: 'auteur_plan' | 'full_production' | 'full_crew', input, context? }`
- Modes: `auteur_plan` (1 agent, 50c), `full_production` (specialists + showrunner, 200c), `full_crew` (all 48 agents + showrunner, 250c)

### `POST /.netlify/functions/generate-video`
- **Body (submit)**: `{ action: 'submit', model: 'seedance-turbo' | 'seedance' | 'veo-3.1', prompt, aspect_ratio? }`
- **Body (result)**: `{ action: 'result', request_id }`
- **Returns (submit)**: `{ request_id }`
- **Returns (result)**: `{ video_url, status }`

### `POST /.netlify/functions/generate-character`
- **Body**: `{ name, description, model?: 'flux-schnell' | 'flux-dev' | 'flux-pro' }`
- **Returns**: `{ image_url, credits_charged }`

### `POST /.netlify/functions/stripe-webhook`
Stripe webhook handler. Verify endpoint in Stripe dashboard.

### `POST /.netlify/functions/verify-owner`
Issue legacy HMAC owner token.
- **Body**: `{ name: 'kyle', password: '<OWNER_PW_KYLE>' }`
- **Returns**: `{ token }` — pass as `Authorization: Bearer <token>` on agent calls

## Running Tests

```bash
cd shotbreak
node test/integration.js
```

Tests mock all external services (Firebase, Anthropic, WaveSpeed, fal.ai, Stripe) with in-memory state. No API keys required. All 17 assertions should pass in ~2 seconds.

## Agent Credit Costs

| Tier | Credits per agent call |
|---|---|
| Tiny agents (normalizers, enrichers) | 5–10 |
| Standard agents | 25–50 |
| Orchestrator (auteur/showrunner) | 50 |
| Full production mode | 200 |
| Full crew mode | 250 |
| Character image (Flux Schnell) | 15 |
| Character image (Flux Pro) | 50 |
| Video generation | 100–300 |

## Prompt Caching

All Anthropic calls use `anthropic-beta: prompt-caching-2024-07-31` with `cache_control: { type: 'ephemeral' }` on system prompts. The agent registry (~189KB) is cached after the first call per Netlify function cold start, reducing cost ~90% and latency 2–4s per cached call.

## Sonnet → Haiku Fallback

Every Anthropic call uses `claude-sonnet-4-5` with an AbortController timer (26s sync / 90s background). On 429/529/503 or stall, the call retries immediately on `claude-haiku-4-5-20251001` with the remaining time budget. Haiku results are flagged in the response (`model_used: 'haiku'`).
