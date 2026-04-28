// ═══════════════════════════════════════════════════════════════════════════
//  SHOTBREAK — Video Generation Proxy v4 (WAVESPEEDAI backend)
//  Drop-in replacement for the fal.ai version. Same actions, same response
//  shape, same auth + credit logic. Frontend (app.html) needs ZERO changes.
//
//  Why WaveSpeedAI:
//   - No waitlist, no approval. Sign up + add card = working API key.
//   - Same models available: Hailuo / Minimax / Veo 3 (T2V).
//   - Simple Bearer-token REST API.
//
//  ENV VARS NEEDED IN NETLIFY:
//    WAVESPEED_API_KEY    — get at https://wavespeed.ai/accesskey
//    FIREBASE_API_KEY     — already set
//    FIREBASE_PROJECT_ID  — already set ("shotbreak-9f342")
//
//  NOTE: FAL_KEY and REPLICATE_API_TOKEN are no longer used. Leave them or
//        delete them, this file ignores both.
// ═══════════════════════════════════════════════════════════════════════════

// ── Model registry ──────────────────────────────────────────────────────
// Each model has BOTH a T2V endpoint (no character lock) and an I2V endpoint
// (locks character via reference image). When the frontend submits a request
// with `character_image_url`, we automatically route to the I2V variant.
//
// All endpoints route through WaveSpeedAI. Lineup as of v23:
//   seedance-turbo  — Seedance 2.0 Fast    (cheapest, native audio, 720p/1080p)
//   seedance        — Seedance 2.0         (top quality I2V, native audio)
//   veo             — Google Veo 3.1 Fast  (premium, audio, 1080p I2V)
const MODELS = {
  "seedance-turbo": {
    label:   "Seedance 2.0 Turbo (audio)",
    minTier: "creator",
    credits: 60,
    t2v: {
      path: "bytedance/seedance-2.0-fast/text-to-video",
      buildInput: ({ prompt, aspect_ratio, duration, negative_prompt }) => {
        const out = {
          prompt:       String(prompt || "").slice(0, 2500),
          aspect_ratio: ["16:9","9:16","1:1"].includes(aspect_ratio) ? aspect_ratio : "16:9",
          duration:     [5, 10, 15].includes(+duration) ? +duration : 5,
          resolution:   "720p",
        };
        // v83: Seedance accepts negative_prompt — when present, the project's
        // global anti-list (from Prompt Writer) is enforced per shot.
        if (negative_prompt) out.negative_prompt = String(negative_prompt).slice(0, 500);
        return out;
      },
    },
    i2v: {
      path: "bytedance/seedance-2.0-fast/image-to-video",
      buildInput: ({ prompt, character_image_url, duration, negative_prompt }) => {
        const out = {
          prompt:     String(prompt || "").slice(0, 2500),
          image_url:  character_image_url,
          duration:   [5, 10, 15].includes(+duration) ? +duration : 5,
          resolution: "720p",
        };
        if (negative_prompt) out.negative_prompt = String(negative_prompt).slice(0, 500);
        return out;
      },
    },
  },
  "seedance": {
    label:   "Seedance 2.0 (audio, top I2V)",
    minTier: "studio",
    credits: 150,
    t2v: {
      path: "bytedance/seedance-2.0/text-to-video",
      buildInput: ({ prompt, aspect_ratio, duration, negative_prompt }) => {
        const out = {
          prompt:       String(prompt || "").slice(0, 2500),
          aspect_ratio: ["16:9","9:16","1:1"].includes(aspect_ratio) ? aspect_ratio : "16:9",
          duration:     [5, 10, 15].includes(+duration) ? +duration : 5,
          resolution:   "720p",
        };
        if (negative_prompt) out.negative_prompt = String(negative_prompt).slice(0, 500);
        return out;
      },
    },
    i2v: {
      path: "bytedance/seedance-2.0/image-to-video",
      buildInput: ({ prompt, character_image_url, duration, negative_prompt }) => {
        const out = {
          prompt:     String(prompt || "").slice(0, 2500),
          image_url:  character_image_url,
          duration:   [5, 10, 15].includes(+duration) ? +duration : 5,
          resolution: "720p",
        };
        if (negative_prompt) out.negative_prompt = String(negative_prompt).slice(0, 500);
        return out;
      },
    },
  },
  "veo": {
    label:   "Google Veo 3.1 Fast (audio, 1080p)",
    minTier: "production",
    credits: 250,
    t2v: {
      path: "google/veo3.1-fast/text-to-video",
      buildInput: ({ prompt, aspect_ratio, generate_audio, negative_prompt }) => {
        const out = {
          prompt:         String(prompt || "").slice(0, 2500),
          aspect_ratio:   ["16:9", "9:16", "1:1"].includes(aspect_ratio) ? aspect_ratio : "16:9",
          duration:       8,
          resolution:     "1080p",
          generate_audio: generate_audio !== false,
        };
        // Veo accepts negative_prompt as well; harmless if it ignores the field.
        if (negative_prompt) out.negative_prompt = String(negative_prompt).slice(0, 500);
        return out;
      },
    },
    i2v: {
      path: "google/veo3.1-fast/image-to-video",
      buildInput: ({ prompt, aspect_ratio, generate_audio, character_image_url, negative_prompt }) => {
        const out = {
          prompt:         String(prompt || "").slice(0, 2500),
          image:          character_image_url,
          aspect_ratio:   ["16:9", "9:16", "1:1"].includes(aspect_ratio) ? aspect_ratio : "16:9",
          duration:       8,
          resolution:     "1080p",
          generate_audio: generate_audio !== false,
        };
        if (negative_prompt) out.negative_prompt = String(negative_prompt).slice(0, 500);
        return out;
      },
    },
  },
};

// Helper to pick T2V or I2V variant based on whether a character image is present
function pickVariant(modelKey, character_image_url) {
  const m = MODELS[modelKey];
  if (!m) return null;
  return character_image_url ? m.i2v : m.t2v;
}

const TIERS = {
  free:       { rank: 0, monthlyCredits: 0      },
  creator:    { rank: 1, monthlyCredits: 500    },
  studio:     { rank: 2, monthlyCredits: 1500   },
  production: { rank: 3, monthlyCredits: 3000   },
  enterprise: { rank: 4, monthlyCredits: 5000   },
  owner:      { rank: 5, monthlyCredits: 999999 },
};

// ── CORS + helpers ──────────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin":  "https://shotbreak.io",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
function respond(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

const { verifyToken, getOrCreateUser, setCredits, getSystemToken } = require('./lib/auth');

// FIRESTORE_BASE is module-local in lib/auth.js (not exported). Define it
// here too so the provision/add_credits actions can write to /users/<uid>.
const FIRESTORE_BASE = () =>
  `https://firestore.googleapis.com/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

// ── WaveSpeedAI API helpers ─────────────────────────────────────────────
const WS_BASE        = "https://api.wavespeed.ai/api/v3";
const WS_TIMEOUT_MS  = 20000;

function ws(path, init = {}) {
  const abortCtrl = new AbortController();
  const abortTimer = setTimeout(() => abortCtrl.abort(), WS_TIMEOUT_MS);
  return fetch(WS_BASE + path, {
    ...init,
    headers: {
      Authorization: "Bearer " + process.env.WAVESPEED_API_KEY,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    signal: abortCtrl.signal,
  }).finally(() => clearTimeout(abortTimer));
}

// Map WaveSpeedAI status strings to fal-style statuses the frontend expects.
// Covers all known WaveSpeed v3 status strings plus common provider variants.
function mapStatus(s) {
  const v = String(s || "").toLowerCase();
  if (v === "completed" || v === "succeeded" || v === "success" || v === "done") return "COMPLETED";
  if (v === "failed"    || v === "error"     || v === "canceled" || v === "cancelled") return "FAILED";
  if (v === "processing"|| v === "running"   || v === "in_progress" || v === "generating") return "IN_PROGRESS";
  // created / queued / pending / unknown → IN_QUEUE
  return "IN_QUEUE";
}

// WaveSpeedAI submit response shape varies; the request_id is usually at
// .data.id or .id. Be defensive.
function extractRequestId(d) {
  return d?.data?.id || d?.id || d?.request_id || d?.task_id || null;
}

// Result endpoint returns an object whose video URL might be at any of
// these spots depending on the model/version. WaveSpeed v3 uses outputs[],
// but some endpoints use download_url or video_url directly.
function extractVideoUrl(d) {
  const cand =
    d?.data?.outputs?.[0] ||
    d?.outputs?.[0] ||
    d?.data?.output ||
    d?.output ||
    d?.data?.download_url ||
    d?.data?.video_url ||
    d?.data?.url ||
    d?.data?.video?.url ||
    d?.video?.url ||
    d?.download_url ||
    d?.video_url ||
    null;
  if (!cand) return null;
  if (typeof cand === "string") return cand;
  if (typeof cand === "object") {
    return cand.url || cand.video_url || cand.download_url || null;
  }
  return null;
}

function extractStatus(d) {
  return d?.data?.status || d?.status || "queued";
}

// ════════════════════════════════════════════════════════════════════════
// HANDLER
// ════════════════════════════════════════════════════════════════════════
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  if (event.httpMethod !== "POST")
    return respond(405, { error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return respond(400, { error: "Invalid JSON body" }); }

  const { action } = body;

  // ── MODELS (public) ──────────────────────────────────────────────────
  if (action === "models") {
    return respond(200, {
      models: Object.entries(MODELS).map(([id, c]) => ({
        id, label: c.label, minTier: c.minTier, credits: c.credits,
      })),
      tiers: Object.entries(TIERS)
        .filter(([k]) => k !== "owner")
        .map(([id, t]) => ({ id, rank: t.rank, monthlyCredits: t.monthlyCredits })),
      backend: "wavespeedai",
    });
  }

  // ── PROXY_CLIP ──────────────────────────────────────────────────────
  // Downloads a WaveSpeed CDN video URL server-side and returns it as
  // binary so the editor can fetch clips without hitting browser CORS.
  // Auth required to prevent open-proxy abuse.
  if (action === "proxy_clip") {
    let auth;
    try { auth = await verifyToken(event); }
    catch { return respond(401, { error: "Login required" }); }

    const { url } = body;
    if (!url || typeof url !== "string") return respond(400, { error: "url required" });

    // Only proxy WaveSpeed CDN domains — don't be an open proxy.
    // Matches wavespeed.ai and any subdomain (output., storage., cdn., etc.)
    const allowed = /^https:\/\/([a-z0-9][a-z0-9-]*\.)*wavespeed\.ai\//i;
    if (!allowed.test(url)) {
      return respond(403, { error: "URL not from an allowed domain" });
    }

    try {
      const r = await fetch(url);
      if (!r.ok) return respond(502, { error: "CDN fetch failed: HTTP " + r.status });
      const buf = await r.arrayBuffer();
      const ct = r.headers.get("content-type") || "video/mp4";
      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "https://shotbreak.io",
          "Content-Type": ct,
          "Cache-Control": "public, max-age=3600",
        },
        body: Buffer.from(buf).toString("base64"),
        isBase64Encoded: true,
      };
    } catch (e) {
      return respond(502, { error: "Proxy fetch failed: " + e.message });
    }
  }

  // ── UPLOAD_IMAGE (character reference photo) ────────────────────────
  // Accepts a base64 data URL from the browser, uploads it to WaveSpeed's
  // media storage, returns a public URL we can pass into I2V endpoints.
  // Auth required (don't let anonymous users burn our storage).
  if (action === "upload_image") {
    let auth;
    try { auth = await verifyToken(event); }
    catch { return respond(401, { error: "Login required" }); }

    const { image_data_url, filename } = body;
    if (!image_data_url) return respond(400, { error: "image_data_url required" });

    // Validate it's a base64 image
    const m = String(image_data_url).match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (!m) return respond(400, { error: "Invalid image_data_url format (expected data:image/...;base64,...)" });

    const mimeType = m[1];
    const base64   = m[2];

    // Sanity size check — base64 is ~33% larger than binary
    // 6MB base64 = ~4.5MB original. Keep references small.
    if (base64.length > 6 * 1024 * 1024) {
      return respond(413, { error: "Image too large. Max 4MB original (6MB base64)." });
    }

    try {
      // Convert base64 -> Buffer for upload
      const buf = Buffer.from(base64, "base64");

      // WaveSpeed's media upload endpoint accepts multipart/form-data
      const form = new FormData();
      const blob = new Blob([buf], { type: mimeType });
      const ext  = mimeType.split("/")[1].replace("jpeg", "jpg").replace("+xml", "");
      form.append("file", blob, filename || `character_${Date.now()}.${ext}`);

      const r = await fetch("https://api.wavespeed.ai/api/v3/media/upload/binary", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + process.env.WAVESPEED_API_KEY,
          // Don't set Content-Type — fetch sets it with boundary for FormData
        },
        body: form,
      });
      const d = await r.json();

      if (!r.ok) {
        return respond(502, {
          error: "Image upload failed",
          detail: d?.message || d?.error || d,
        });
      }

      // WaveSpeed responds with { code, message, data: { download_url, type, filename, size } }
      const url = d?.data?.download_url || d?.data?.url || d?.url;
      if (!url) {
        return respond(502, {
          error: "Upload succeeded but no URL returned",
          raw: d,
        });
      }

      return respond(200, { url, backend: "wavespeedai", note: "Reference image stored for 7 days" });
    } catch (e) {
      return respond(502, { error: "Upload exception: " + e.message });
    }
  }

  // ── BALANCE ─────────────────────────────────────────────────────────
  if (action === "balance") {
    let auth;
    try { auth = await verifyToken(event); }
    catch { return respond(401, { error: "Login required" }); }

    if (auth.isOwner) {
      return respond(200, { credits: 999999, tier: "owner", isOwner: true });
    }
    const user = await getOrCreateUser(auth.uid);
    return respond(200, {
      credits: user?.credits || 0,
      tier:    user?.tier    || "free",
      isOwner: false,
    });
  }

  // ── PROVISION (owner-only) ──────────────────────────────────────────
  if (action === "provision") {
    let auth;
    try { auth = await verifyToken(event); }
    catch { return respond(401, { error: "Login required" }); }
    if (!auth.isOwner) return respond(403, { error: "Owner only" });

    const { targetUid, tier } = body;
    if (!targetUid || !TIERS[tier])
      return respond(400, { error: "targetUid + valid tier required" });

    const totalCredits = TIERS[tier].monthlyCredits;
    const sysToken = await getSystemToken();
    await fetch(`${FIRESTORE_BASE()}/users/${targetUid}?updateMask.fieldPaths=tier&updateMask.fieldPaths=credits`, {
      method: "PATCH",
      headers: {
        Authorization: "Bearer " + sysToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          tier:    { stringValue:  tier },
          credits: { integerValue: String(totalCredits) },
        },
      }),
    });
    return respond(200, {
      success: true,
      provisioned: { uid: targetUid, tier, credits: totalCredits },
    });
  }

  // ── ADD CREDITS (owner-only) ────────────────────────────────────────
  if (action === "add_credits") {
    let auth;
    try { auth = await verifyToken(event); }
    catch { return respond(401, { error: "Login required" }); }
    if (!auth.isOwner) return respond(403, { error: "Owner only" });

    const { targetUid, amount } = body;
    if (!targetUid || !amount)
      return respond(400, { error: "targetUid + amount required" });

    const user = await getOrCreateUser(targetUid);
    const current = user?.credits || 0;
    await setCredits(targetUid, current + amount);
    return respond(200, {
      success: true, uid: targetUid, added: amount,
      newBalance: current + amount,
    });
  }

  // ── SUBMIT (deduct credits + queue WaveSpeedAI prediction) ──────────
  if (action === "submit") {
    let auth;
    try { auth = await verifyToken(event); }
    catch { return respond(401, { error: "Login required" }); }

    const { model, prompt, duration, aspect_ratio, generate_audio, character_image_url, negative_prompt } = body;
    const cfg = MODELS[model];
    if (!cfg)    return respond(400, { error: "Unknown model: " + model });
    if (!prompt) return respond(400, { error: "prompt required" });

    // Route to T2V or I2V based on whether a character reference image was provided
    const variant = pickVariant(model, character_image_url);
    if (!variant) return respond(400, { error: "No variant available for: " + model });

    let userTier = "owner";
    let userCredits = 999999;
    if (!auth.isOwner) {
      const user = await getOrCreateUser(auth.uid);
      userTier    = user?.tier    || "free";
      userCredits = user?.credits || 0;

      if (TIERS[userTier].rank < TIERS[cfg.minTier].rank) {
        return respond(403, {
          error: `${cfg.label} requires ${cfg.minTier} tier or higher`,
          requiredTier: cfg.minTier, yourTier: userTier,
        });
      }
      if (userCredits < cfg.credits) {
        return respond(402, {
          error: "Insufficient credits",
          required: cfg.credits, available: userCredits,
        });
      }
      // Deduct BEFORE calling provider
      await setCredits(auth.uid, userCredits - cfg.credits);
    }

    let submitted;
    try {
      const input = variant.buildInput({ prompt, duration, aspect_ratio, generate_audio, character_image_url, negative_prompt });
      const r = await ws(`/${variant.path}`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      submitted = await r.json();

      if (!r.ok) {
        // REFUND on submit failure
        if (!auth.isOwner) {
          await setCredits(auth.uid, userCredits).catch(() => {});
        }
        return respond(502, {
          error: "WaveSpeedAI submit failed",
          detail: submitted?.message || submitted?.error || submitted,
        });
      }
    } catch (e) {
      if (!auth.isOwner) {
        await setCredits(auth.uid, userCredits).catch(() => {});
      }
      return respond(502, { error: "WaveSpeedAI unreachable", detail: e.message });
    }

    const requestId = extractRequestId(submitted);
    if (!requestId) {
      // Refund — bad response shape from provider
      if (!auth.isOwner) {
        await setCredits(auth.uid, userCredits).catch(() => {});
      }
      return respond(502, {
        error: "No request_id returned by provider",
        raw: submitted,
      });
    }

    return respond(200, {
      request_id: requestId,
      status:     mapStatus(extractStatus(submitted)),
      model,
      credits_charged: auth.isOwner ? 0 : cfg.credits,
      backend: "wavespeedai",
    });
  }

  // ── STATUS (lightweight poll) ───────────────────────────────────────
  if (action === "status") {
    const { request_id } = body;
    if (!request_id) return respond(400, { error: "request_id required" });
    try {
      const r = await ws(`/predictions/${request_id}/result`);
      const raw = await r.text();
      let d;
      try { d = JSON.parse(raw); } catch { d = {}; }
      if (!r.ok) {
        // Don't crash the poll — return safe IN_QUEUE with debug info
        return respond(200, {
          status: "IN_QUEUE", request_id,
          warning: d?.message || ("HTTP " + r.status),
          _debug: raw.slice(0, 300),
        });
      }
      const mappedStatus = mapStatus(extractStatus(d));
      // If already completed, also surface the video URL so the client can
      // skip the separate result fetch (one less round-trip).
      const earlyUrl = mappedStatus === "COMPLETED" ? extractVideoUrl(d) : null;
      return respond(200, {
        status:    mappedStatus,
        request_id,
        progress:  extractStatus(d),
        video_url: earlyUrl || undefined,
        _raw_status: extractStatus(d),
      });
    } catch (e) {
      return respond(200, { status: "IN_QUEUE", request_id, warning: e.message });
    }
  }

  // ── RESULT (fetch the finished video) ───────────────────────────────
  if (action === "result") {
    const { request_id } = body;
    if (!request_id) return respond(400, { error: "request_id required" });
    try {
      const r = await ws(`/predictions/${request_id}/result`);
      const raw = await r.text();
      let d;
      try { d = JSON.parse(raw); } catch { d = {}; }
      if (!r.ok) {
        return respond(502, {
          error:     "WaveSpeedAI result fetch failed",
          detail:    d?.message || ("HTTP " + r.status),
          video_url: null,
          _debug:    raw.slice(0, 300),
        });
      }
      const videoUrl = extractVideoUrl(d);
      return respond(200, {
        status:    mapStatus(extractStatus(d)),
        video_url: videoUrl,
        // Frontend compatibility: also expose under common alt keys
        video:     videoUrl ? { url: videoUrl } : null,
        videos:    videoUrl ? [{ url: videoUrl }] : [],
        raw:       {
          id: request_id,
          status: extractStatus(d),
          error: d?.error || d?.data?.error || null,
          // Include raw outputs so client can inspect if URL extraction fails
          outputs: d?.data?.outputs || d?.outputs || null,
        },
      });
    } catch (e) {
      return respond(502, { error: e.message, video_url: null });
    }
  }

  return respond(400, { error: "Unknown action: " + action });
};
