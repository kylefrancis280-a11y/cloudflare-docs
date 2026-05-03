// ═══════════════════════════════════════════════════════════════════════════
//  SHOTBREAK — Stripe Webhook Handler (zero-dependency version)
//
//  No npm packages required. Uses Node built-ins (crypto, fetch) only —
//  matches the style of your other Netlify functions. Drag this file to
//  Netlify like any other function.
//
//  Handles ALL tier/credit changes. The client NEVER writes tier or credits
//  directly — every change originates here, server-side, verified by Stripe
//  signature.
//
//  Events handled:
//    checkout.session.completed        — first-time subscription OR credit pack
//    customer.subscription.updated     — tier changes, pauses, status updates
//    customer.subscription.deleted     — cancellations → downgrade to free
//    invoice.payment_succeeded         — monthly renewal → refill credits
//    invoice.payment_failed            — mark past_due
//
//  ENV VARS REQUIRED IN NETLIFY:
//    STRIPE_SECRET_KEY         — sk_live_...
//    STRIPE_WEBHOOK_SECRET     — whsec_... (from the webhook endpoint page)
//    FIREBASE_API_KEY          — already set
//    FIREBASE_PROJECT_ID       — already set ("shotbreak-9f342")
//    SYSTEM_EMAIL              — service user, e.g. system@shotbreak.app
//    SYSTEM_PASSWORD           — strong password for that Firebase user
//
//  HOW USER IS IDENTIFIED:
//    client_reference_id must be appended to the Payment Link URL before
//    redirecting the user to Stripe. Value = firebase_uid. Without this,
//    the webhook logs a warning and bails.
//
//  HOW TIER/CREDITS ARE DETERMINED:
//    Each Payment Link in Stripe must have metadata set:
//      sb_type     = "subscription"  OR  "credit_pack"
//      sb_tier     = "creator" | "studio" | "production" | "enterprise"
//      sb_credits  = "500" | "1500" | "3000" | "5000" | ...  (string)
//    Stripe copies Payment Link metadata to Checkout Sessions and (via our
//    code below) onto the Subscription object too.
// ═══════════════════════════════════════════════════════════════════════════

const crypto = require("crypto");

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

// ── Stripe signature verification (manual, no npm) ──────────────────────
// Stripe-Signature header format: "t=TIMESTAMP,v1=SIG,v1=SIG2,..."
// Signed payload: "TIMESTAMP.RAW_BODY"
// Expected sig:   HMAC-SHA256(webhookSecret, signedPayload)
// We accept any v1 sig that matches (Stripe may rotate during roll).
function verifyStripeSignature(rawBody, header, secret, toleranceSec) {
  if (!header || !secret) return null;
  const parts = header.split(",").map((p) => p.trim());
  let timestamp = null;
  const sigs = [];
  for (const p of parts) {
    const [k, v] = p.split("=");
    if (k === "t") timestamp = parseInt(v, 10);
    else if (k === "v1") sigs.push(v);
  }
  if (!timestamp || !sigs.length) return null;

  // Reject events older than tolerance (default 5 min) to block replays.
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - timestamp) > (toleranceSec || 300)) return null;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");

  // Timing-safe compare against every provided v1 sig.
  for (const sig of sigs) {
    const sigBuf = Buffer.from(sig, "utf8");
    if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      try { return JSON.parse(rawBody); } catch { return null; }
    }
  }
  return null;
}

// ── Stripe REST API helpers (manual, no npm) ────────────────────────────
const STRIPE_API = "https://api.stripe.com/v1";

function stripeAuthHeader() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  // Stripe uses HTTP Basic: base64(secret_key + ":")
  return "Basic " + Buffer.from(key + ":").toString("base64");
}

// Convert a flat object to application/x-www-form-urlencoded, which is
// what Stripe's API expects for POST bodies. Supports nested { metadata: {...} }
// by flattening to metadata[key]=value.
function toFormBody(obj) {
  const pairs = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v)) {
        if (v2 === null || v2 === undefined) continue;
        pairs.push(`${encodeURIComponent(k)}[${encodeURIComponent(k2)}]=${encodeURIComponent(v2)}`);
      }
    } else {
      pairs.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
  }
  return pairs.join("&");
}

const STRIPE_TIMEOUT_MS = 15000;

function stripeAbortController() {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), STRIPE_TIMEOUT_MS);
  return { signal: ctrl.signal, clear: () => clearTimeout(timer) };
}

// Transient errors (network timeout, 408, 429, 5xx) are tagged so the outer
// handler can return 500 and let Stripe retry. Permanent errors (4xx other
// than 408/429) are NOT tagged — the caller may still treat as fatal but
// retrying won't help.
function makeTransient(err) {
  err.transient = true;
  return err;
}
function isTransientStatus(status) {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

async function stripeGet(path) {
  const { signal, clear } = stripeAbortController();
  try {
    const r = await fetch(STRIPE_API + path, {
      headers: { Authorization: stripeAuthHeader() },
      signal,
    });
    clear();
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(`STRIPE_GET_FAIL ${path} ${r.status}: ${JSON.stringify(d)}`);
      if (isTransientStatus(r.status)) makeTransient(e);
      throw e;
    }
    return d;
  } catch (e) {
    clear();
    if (e.name === "AbortError") throw makeTransient(new Error(`STRIPE_TIMEOUT ${path}`));
    // Network-level errors (DNS, ECONNRESET, fetch TypeError) are transient.
    if (!e.transient && (e.name === "TypeError" || e.code === "ECONNRESET" || e.code === "ETIMEDOUT")) {
      makeTransient(e);
    }
    throw e;
  }
}

async function stripePost(path, body) {
  const { signal, clear } = stripeAbortController();
  try {
    const r = await fetch(STRIPE_API + path, {
      method: "POST",
      headers: {
        Authorization: stripeAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body:   toFormBody(body || {}),
      signal,
    });
    clear();
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(`STRIPE_POST_FAIL ${path} ${r.status}: ${JSON.stringify(d)}`);
      if (isTransientStatus(r.status)) makeTransient(e);
      throw e;
    }
    return d;
  } catch (e) {
    clear();
    if (e.name === "AbortError") throw makeTransient(new Error(`STRIPE_TIMEOUT ${path}`));
    if (!e.transient && (e.name === "TypeError" || e.code === "ECONNRESET" || e.code === "ETIMEDOUT")) {
      makeTransient(e);
    }
    throw e;
  }
}

// ── Firebase REST helpers ───────────────────────────────────────────────
const FIRESTORE_BASE = () =>
  `https://firestore.googleapis.com/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

// Cached system token — same pattern as other functions.
let _systemTokenCache = { token: null, expires: 0 };
async function getSystemToken() {
  const now = Date.now();
  if (_systemTokenCache.token && _systemTokenCache.expires > now + 60_000) {
    return _systemTokenCache.token;
  }
  const email    = process.env.SYSTEM_EMAIL;
  const password = process.env.SYSTEM_PASSWORD;
  if (!email || !password) throw new Error("SYSTEM_EMAIL / SYSTEM_PASSWORD not configured");
  const r = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + process.env.FIREBASE_API_KEY,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const d = await r.json();
  if (!r.ok || !d.idToken) {
    const e = new Error("SYSTEM_AUTH_FAIL: " + JSON.stringify(d));
    if (isTransientStatus(r.status)) makeTransient(e);
    throw e;
  }
  _systemTokenCache = { token: d.idToken, expires: now + (parseInt(d.expiresIn || "3600", 10) * 1000) };
  return d.idToken;
}

async function readUser(uid, token) {
  const r = await fetch(`${FIRESTORE_BASE()}/users/${uid}`, {
    headers: { Authorization: "Bearer " + token },
  });
  if (r.status === 404) return null;
  if (!r.ok) {
    const e = new Error("USER_READ_FAIL_" + r.status);
    if (isTransientStatus(r.status)) makeTransient(e);
    throw e;
  }
  const d = await r.json();
  const f = d.fields || {};
  return {
    tier: f.tier?.stringValue || "free",
    credits: parseInt(f.credits?.integerValue || "0", 10),
    name: f.name?.stringValue || "",
    email: f.email?.stringValue || "",
    lastProcessedStripeEvent: f.lastProcessedStripeEvent?.stringValue || "",
  };
}

function toFirestoreFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "number" && Number.isInteger(v)) out[k] = { integerValue: String(v) };
    else if (typeof v === "number") out[k] = { doubleValue: v };
    else if (typeof v === "boolean") out[k] = { booleanValue: v };
    else if (v instanceof Date) out[k] = { timestampValue: v.toISOString() };
    else out[k] = { stringValue: String(v) };
  }
  return out;
}

// Bootstrap a fresh user doc on demand. Used when a Stripe webhook fires
// before the user has ever signed into Firebase (anon checkout, or signup
// flow that lands on Stripe before the app). Mirrors lib/auth.js
// getOrCreateUser semantics: tier=free, credits=0, created_at, updated_at.
// Throws transient on Firestore 5xx so Stripe retries.
async function createUser(uid, token, seed) {
  const now = new Date();
  const fields = {
    tier: (seed && seed.tier) || "free",
    credits: (seed && typeof seed.credits === "number") ? seed.credits : 0,
    createdAt: now,
    updatedAt: now,
  };
  const url = `${FIRESTORE_BASE()}/users?documentId=${encodeURIComponent(uid)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: toFirestoreFields(fields) }),
  });
  if (r.ok) {
    return {
      tier: fields.tier,
      credits: fields.credits,
      name: "",
      email: "",
      lastProcessedStripeEvent: "",
    };
  }
  // 409 ALREADY_EXISTS → race: another concurrent webhook just created it.
  // Re-read so caller gets current state (including any lastProcessedStripeEvent).
  if (r.status === 409) {
    const existing = await readUser(uid, token);
    if (existing) return existing;
    // Fall through to error if read still returns null (shouldn't happen).
  }
  const errText = await r.text().catch(() => "");
  const e = new Error("USER_CREATE_FAIL_" + r.status + ": " + errText);
  if (isTransientStatus(r.status)) makeTransient(e);
  throw e;
}

async function patchUser(uid, fields, token) {
  const mask = Object.keys(fields)
    .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join("&");
  const url = `${FIRESTORE_BASE()}/users/${uid}?${mask}`;
  const r = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: toFirestoreFields(fields) }),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    const e = new Error("USER_WRITE_FAIL_" + r.status + ": " + errText);
    if (isTransientStatus(r.status)) makeTransient(e);
    throw e;
  }
}

// ── Webhook idempotency (dedup by Stripe event ID) ──────────────────────
// Try to create a doc at processedWebhooks/{eventId} with createDocument,
// which fails if the doc already exists. Returns true if WE just claimed
// the event (proceed with processing), false if it was already processed.
async function claimWebhookEvent(eventId, token) {
  const safeId = String(eventId).replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeId) return true; // can't dedup — fail open rather than block legit events
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  const url =
    `${FIRESTORE_BASE()}/processedWebhooks?documentId=${encodeURIComponent(safeId)}`;
  const body = {
    fields: toFirestoreFields({
      event_id: safeId,
      processed_at: new Date(),
      expires_at: expiresAt,
    }),
  };
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (r.ok) return true;
  // 409 ALREADY_EXISTS → already processed.
  if (r.status === 409) return false;
  // For other errors (auth, network), surface so we don't silently drop events.
  const errText = await r.text().catch(() => "");
  const e = new Error("WEBHOOK_DEDUP_FAIL_" + r.status + ": " + errText);
  if (isTransientStatus(r.status)) makeTransient(e);
  throw e;
}

// ── Tier detection ──────────────────────────────────────────────────────
// We infer the tier from the Stripe product name rather than requiring
// metadata on every Payment Link. Product names are:
//   "SHOTBREAK Creator", "SHOTBREAK Studio", "SHOTBREAK Production",
//   "SHOTBREAK Enterprise", or anything containing "credit" for credit packs.
const TIER_CREDITS = {
  creator: 500,
  studio: 1500,
  production: 3000,
  enterprise: 5000,
};

function detectTierFromName(name) {
  if (!name) return null;
  const lower = String(name).toLowerCase();
  if (lower.includes("creator")) return "creator";
  if (lower.includes("studio")) return "studio";
  if (lower.includes("production")) return "production";
  if (lower.includes("enterprise")) return "enterprise";
  return null;
}

function isCreditPackName(name) {
  if (!name) return false;
  const lower = String(name).toLowerCase();
  return lower.includes("credit") && (lower.includes("pack") || lower.includes("top"));
}

// Pull credit count out of a credit-pack product name.
// "200 credit pack" → 200, "SHOTBREAK 1000 credits" → 1000.
function detectCreditsFromName(name) {
  if (!name) return null;
  const m = String(name).match(/(\d{2,5})/);
  return m ? parseInt(m[1], 10) : null;
}

// Fetch a subscription's product name by retrieving the price → product.
async function resolveSubscriptionProduct(sub) {
  const priceId = sub?.items?.data?.[0]?.price?.id;
  if (!priceId) return null;
  const price = await stripeGet(`/prices/${priceId}?expand[]=product`);
  const prod = price?.product;
  // If product wasn't expanded (shouldn't happen with expand flag), fetch it.
  if (typeof prod === "string") {
    const p = await stripeGet(`/products/${prod}`);
    return p?.name || null;
  }
  return prod?.name || null;
}

// Fetch the first line item's product name from a Checkout Session.
async function resolveSessionProduct(session) {
  const items = await stripeGet(`/checkout/sessions/${session.id}/line_items?expand[]=data.price.product&limit=1`);
  const item = items?.data?.[0];
  const prod = item?.price?.product;
  if (!prod) return null;
  if (typeof prod === "string") {
    const p = await stripeGet(`/products/${prod}`);
    return p?.name || null;
  }
  return prod?.name || null;
}

// ── Event handlers ──────────────────────────────────────────────────────

async function handleCheckoutCompleted(session, token, eventId) {
  // ── IDEMPOTENCY DESIGN (do not reorder without reading) ──────────────
  // To avoid the "user paid, gets nothing" race where claimWebhookEvent
  // creates the global dedup doc BEFORE credit grant and any subsequent
  // step throws (Stripe sees the doc on retry → no credits granted), we:
  //   1. Do all read-only / Stripe-API work first (no Firestore writes).
  //   2. Stamp the user doc with `lastProcessedStripeEvent = eventId` in
  //      the SAME PATCH that grants credits / sets tier. Before granting,
  //      we read the user doc and bail out idempotently if their
  //      lastProcessedStripeEvent already matches this eventId — that
  //      makes the credit grant safely re-runnable on Stripe retry.
  //   3. Claim the global processedWebhooks/{eventId} doc LAST. If steps
  //      1-2 throw, this never runs, so Stripe will retry, and the
  //      user-doc check in step 2 prevents double-granting.
  // ─────────────────────────────────────────────────────────────────────
  const uid = session.client_reference_id;
  if (!uid) {
    console.warn("[webhook] checkout.session.completed with no client_reference_id — session:", session.id);
    return { skipped: "no_uid" };
  }
  if (!/^[a-zA-Z0-9_-]{20,128}$/.test(uid)) {
    console.warn("[webhook] checkout.session.completed with invalid client_reference_id format:", uid);
    return { skipped: "invalid_client_reference_id" };
  }

  // Figure out what was purchased by looking at the product name.
  // resolveSessionProduct may throw a transient error (timeout, 5xx) — we
  // let it propagate so the outer handler returns 500 and Stripe retries.
  const productName = await resolveSessionProduct(session);
  console.log(`[webhook] session ${session.id} product: "${productName}"`);

  // ONE-TIME CREDIT PACK
  if (session.mode === "payment") {
    if (!isCreditPackName(productName)) {
      console.warn("[webhook] payment-mode session but product isn't a credit pack:", productName);
      return { skipped: "not_credit_pack" };
    }
    const creditsToAdd = detectCreditsFromName(productName);
    if (!creditsToAdd) {
      console.warn("[webhook] credit pack with no parseable credit count:", productName);
      return { skipped: "no_credit_amount" };
    }
    let user = await readUser(uid, token);
    if (!user) {
      // First-time Stripe purchase by a user without an existing Firestore
      // doc (anon checkout, or signed up via Stripe before app). Bootstrap
      // the doc so we don't silently drop the credits they paid for.
      console.log(`[webhook] bootstrapping user doc for credit pack: uid=${uid}`);
      try {
        user = await createUser(uid, token, { tier: "free", credits: 0 });
      } catch (e) {
        if (!e.transient) makeTransient(e);
        throw e;
      }
    }
    // Per-user idempotency: if we already processed this event for this
    // user, don't double-grant. (Guards against a retry that arrives
    // before the global dedup doc was created.)
    if (eventId && user.lastProcessedStripeEvent === eventId) {
      console.log(`[webhook] event ${eventId} already applied to uid=${uid}, skipping grant`);
    } else {
      const newCredits = (user.credits || 0) + creditsToAdd;
      const updates = {
        credits: newCredits,
        lastCreditPackAt: new Date(),
      };
      if (eventId) updates.lastProcessedStripeEvent = eventId;
      await patchUser(uid, updates, token);
      console.log(`[webhook] credit pack: uid=${uid} +${creditsToAdd} → ${newCredits}`);
    }
    // LAST WRITE: claim the global event record. If this fails transiently,
    // Stripe will retry — the user-doc check above makes that safe.
    if (eventId) {
      const claimed = await claimWebhookEvent(eventId, token);
      if (!claimed) console.log(`[webhook] event ${eventId} dedup doc already exists (expected on retry)`);
    }
    return { ok: true };
  }

  // NEW SUBSCRIPTION
  if (session.mode === "subscription") {
    const subId = session.subscription;
    if (!subId) return { skipped: "no_subscription_id" };

    const tier = detectTierFromName(productName);
    if (!tier || !TIER_CREDITS[tier]) {
      console.warn("[webhook] subscription product name didn't match any tier:", productName);
      return { skipped: "unknown_tier" };
    }
    const credits = TIER_CREDITS[tier];

    // Per-user idempotency check before any writes.
    let existingUser = await readUser(uid, token);
    if (!existingUser) {
      // First-time Stripe purchase by a user without an existing Firestore
      // doc. Bootstrap so subsequent writes have a base to update.
      console.log(`[webhook] bootstrapping user doc for new subscription: uid=${uid}`);
      try {
        existingUser = await createUser(uid, token, { tier: "free", credits: 0 });
      } catch (e) {
        if (!e.transient) makeTransient(e);
        throw e;
      }
    }
    if (eventId && existingUser && existingUser.lastProcessedStripeEvent === eventId) {
      console.log(`[webhook] event ${eventId} already applied to uid=${uid}, skipping subscription setup`);
      const claimed = await claimWebhookEvent(eventId, token);
      if (!claimed) console.log(`[webhook] event ${eventId} dedup doc already exists (expected on retry)`);
      return { ok: true, tier, credits, idempotent: true };
    }

    // Stamp firebase_uid + tier onto subscription metadata so future webhook
    // events (renewals, cancels) can find the user and know the tier without
    // re-fetching product info.
    const sub = await stripeGet(`/subscriptions/${subId}`);
    await stripePost(`/subscriptions/${subId}`, {
      metadata: {
        ...(sub.metadata || {}),
        firebase_uid: uid,
        sb_tier: tier,
      },
    });

    const subUpdates = {
      tier,
      credits,
      stripeCustomerId: sub.customer,
      stripeSubscriptionId: subId,
      subscriptionStatus: sub.status,
      subscriptionStartedAt: new Date(),
    };
    if (eventId) subUpdates.lastProcessedStripeEvent = eventId;
    await patchUser(uid, subUpdates, token);
    console.log(`[webhook] new subscription: uid=${uid} tier=${tier} credits=${credits}`);

    // LAST WRITE: claim the global event record.
    if (eventId) {
      const claimed = await claimWebhookEvent(eventId, token);
      if (!claimed) console.log(`[webhook] event ${eventId} dedup doc already exists (expected on retry)`);
    }
    return { ok: true, tier, credits };
  }

  return { skipped: "unknown_mode_" + session.mode };
}

async function handleSubscriptionUpdated(sub, token) {
  const uid = sub.metadata?.firebase_uid;
  if (!uid) {
    console.warn("[webhook] subscription.updated with no firebase_uid metadata:", sub.id);
    return { skipped: "no_uid" };
  }
  // Use stamped sb_tier if present, else re-resolve from product name.
  let tier = sub.metadata?.sb_tier;
  if (!tier || !TIER_CREDITS[tier]) {
    const productName = await resolveSubscriptionProduct(sub);
    tier = detectTierFromName(productName);
  }
  const updates = { subscriptionStatus: sub.status };
  if (tier && TIER_CREDITS[tier]) {
    updates.tier = tier;
    const user = await readUser(uid, token);
    if (user && user.tier !== tier) {
      // Tier actually changed — refill credits to match new tier.
      updates.credits = TIER_CREDITS[tier];
    }
  }
  await patchUser(uid, updates, token);
  console.log(`[webhook] subscription updated: uid=${uid} status=${sub.status} tier=${tier}`);
  return { ok: true };
}

async function handleSubscriptionDeleted(sub, token) {
  const uid = sub.metadata?.firebase_uid;
  if (!uid) {
    console.warn("[webhook] subscription.deleted with no firebase_uid metadata:", sub.id);
    return { skipped: "no_uid" };
  }
  await patchUser(uid, {
    tier: "free",
    credits: 0,
    subscriptionStatus: "canceled",
    subscriptionEndedAt: new Date(),
  }, token);
  console.log(`[webhook] subscription canceled: uid=${uid} → free`);
  return { ok: true };
}

async function handleInvoicePaid(invoice, token) {
  if (invoice.billing_reason !== "subscription_cycle") {
    return { skipped: "not_renewal_" + invoice.billing_reason };
  }
  const subId = invoice.subscription;
  if (!subId) return { skipped: "no_sub" };

  const sub = await stripeGet(`/subscriptions/${subId}`);
  const uid = sub.metadata?.firebase_uid;
  if (!uid) {
    console.warn("[webhook] renewal invoice with no firebase_uid on sub:", subId);
    return { skipped: "no_uid" };
  }
  let tier = sub.metadata?.sb_tier;
  if (!tier || !TIER_CREDITS[tier]) {
    const productName = await resolveSubscriptionProduct(sub);
    tier = detectTierFromName(productName);
  }
  const credits = tier ? TIER_CREDITS[tier] : 0;
  if (!credits) {
    console.warn("[webhook] renewal couldn't determine tier for sub:", subId);
    return { skipped: "unknown_tier" };
  }
  await patchUser(uid, {
    credits,
    subscriptionStatus: sub.status,
    lastRenewalAt: new Date(),
  }, token);
  console.log(`[webhook] renewal: uid=${uid} credits reset to ${credits}`);
  return { ok: true };
}

async function handleInvoiceFailed(invoice, token) {
  const subId = invoice.subscription;
  if (!subId) return { skipped: "no_sub" };
  const sub = await stripeGet(`/subscriptions/${subId}`);
  const uid = sub.metadata?.firebase_uid;
  if (!uid) return { skipped: "no_uid" };
  await patchUser(uid, { subscriptionStatus: "past_due" }, token);
  console.log(`[webhook] payment failed: uid=${uid} → past_due`);
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return respond(405, { error: "POST only" });

  const sig = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
  if (!sig) return respond(400, { error: "Missing stripe-signature header" });
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("[webhook] STRIPE_WEBHOOK_SECRET not configured");
    return respond(500, { error: "Server misconfigured" });
  }

  const stripeEvent = verifyStripeSignature(
    event.body,
    sig,
    process.env.STRIPE_WEBHOOK_SECRET,
    300
  );
  if (!stripeEvent) {
    console.error("[webhook] signature verification failed");
    return respond(400, { error: "Invalid signature" });
  }

  // Return 200 for events we intentionally skip or successfully handle.
  // Return 500 for TRANSIENT failures (timeouts, Stripe/Firestore 5xx) so
  // Stripe retries the webhook. Permanent failures still 200 (no point in
  // retrying — the data is malformed or doesn't apply to us).
  try {
    const token = await getSystemToken();
    let result;
    switch (stripeEvent.type) {
      case "checkout.session.completed":
        result = await handleCheckoutCompleted(stripeEvent.data.object, token, stripeEvent.id); break;
      case "customer.subscription.updated":
        result = await handleSubscriptionUpdated(stripeEvent.data.object, token); break;
      case "customer.subscription.deleted":
        result = await handleSubscriptionDeleted(stripeEvent.data.object, token); break;
      case "invoice.payment_succeeded":
        result = await handleInvoicePaid(stripeEvent.data.object, token); break;
      case "invoice.payment_failed":
        result = await handleInvoiceFailed(stripeEvent.data.object, token); break;
      default:
        result = { skipped: "unhandled_event_" + stripeEvent.type };
    }
    return respond(200, { received: true, ...result });
  } catch (err) {
    console.error("[webhook] handler error on", stripeEvent.type, err);
    // Transient errors: 500 so Stripe retries. Permanent: 200 to ack.
    if (err && err.transient) {
      return respond(500, { received: false, error: String(err.message), transient: true });
    }
    return respond(200, { received: true, error: String(err.message) });
  }
};
