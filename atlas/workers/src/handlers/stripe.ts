import type { Env, SubStatus, Tier } from '../env';
import { bytesToHex, timingSafeEqual } from '../lib/http';

// Strict Stripe signature verification — refuses unsigned/unverifiable requests.
// Replaces the legacy implementation that returned `true` when STRIPE_WEBHOOK_SECRET was unset.
async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  toleranceSec = 300,
): Promise<{ ok: true; ts: number } | { ok: false; reason: string }> {
  if (!secret) return { ok: false, reason: 'webhook_secret_unset' };
  if (!header) return { ok: false, reason: 'missing_signature_header' };

  const parts = header.split(',').reduce<Record<string, string[]>>((acc, p) => {
    const [k, v] = p.trim().split('=');
    if (!k || !v) return acc;
    (acc[k] ??= []).push(v);
    return acc;
  }, {});

  const ts = Number(parts.t?.[0]);
  const sigs = parts.v1 ?? [];
  if (!ts || !sigs.length) return { ok: false, reason: 'malformed_signature_header' };

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > toleranceSec) return { ok: false, reason: 'timestamp_outside_tolerance' };

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const expected = bytesToHex(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}.${payload}`)),
  );

  for (const provided of sigs) {
    if (timingSafeEqual(provided, expected)) return { ok: true, ts };
  }
  return { ok: false, reason: 'signature_mismatch' };
}

function amountToTier(cents: number): Tier {
  if (cents >= 9500) return 'institutional';
  if (cents >= 4500) return 'pro';
  if (cents >= 2500) return 'core';
  return 'core';
}

async function updateUser(env: Env, email: string | null, customerId: string | null, status: SubStatus, tier: Tier | null): Promise<void> {
  if (!email && !customerId) return;
  const norm = email?.toLowerCase().trim() ?? null;

  if (norm) {
    const existing = await env.DB.prepare(`SELECT id FROM users WHERE email = ? LIMIT 1`).bind(norm).first<{ id: string }>();
    if (existing) {
      await env.DB.prepare(
        `UPDATE users SET stripe_customer_id = COALESCE(?, stripe_customer_id),
                          subscription_status = ?,
                          tier = COALESCE(?, tier),
                          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?`,
      ).bind(customerId, status, tier, existing.id).run();
      return;
    }
  }

  if (customerId) {
    const existingByCustomer = await env.DB.prepare(`SELECT id FROM users WHERE stripe_customer_id = ? LIMIT 1`)
      .bind(customerId).first<{ id: string }>();
    if (existingByCustomer) {
      await env.DB.prepare(
        `UPDATE users SET subscription_status = ?,
                          tier = COALESCE(?, tier),
                          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?`,
      ).bind(status, tier, existingByCustomer.id).run();
      return;
    }
  }

  // No matching user yet — defer until signup, but log so we can backfill.
  await env.DB.prepare(
    `INSERT INTO audit_log (user_id, action, details) VALUES (NULL, 'stripe_unmatched_event',
      json_object('email', ?, 'customer', ?, 'status', ?, 'tier', ?))`,
  ).bind(norm, customerId, status, tier).run().catch(() => {});
}

export async function handleStripeWebhook(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });
  const sig = req.headers.get('stripe-signature');
  const payload = await req.text();
  const v = await verifyStripeSignature(payload, sig, env.STRIPE_WEBHOOK_SECRET ?? '');
  if (!v.ok) {
    return new Response(JSON.stringify({ error: 'signature_invalid', reason: v.reason }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let event: any;
  try { event = JSON.parse(payload); } catch { return new Response('Bad payload', { status: 400 }); }
  const obj = event.data?.object ?? {};

  switch (event.type) {
    case 'checkout.session.completed': {
      const email = obj.customer_email ?? obj.customer_details?.email ?? null;
      const customerId = obj.customer ?? null;
      const tier = amountToTier(obj.amount_total ?? 0);
      await updateUser(env, email, customerId, 'active', tier);
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const status = obj.status === 'active' || obj.status === 'trialing' ? 'active' : 'inactive';
      const amount = obj.items?.data?.[0]?.price?.unit_amount;
      const tier = amount ? amountToTier(amount) : null;
      await updateUser(env, null, obj.customer ?? null, status, tier);
      break;
    }
    case 'customer.subscription.deleted':
      await updateUser(env, null, obj.customer ?? null, 'cancelled', 'none');
      break;
    case 'invoice.payment_failed':
      await updateUser(env, null, obj.customer ?? null, 'past_due', null);
      break;
    case 'invoice.payment_succeeded':
      await updateUser(env, null, obj.customer ?? null, 'active', null);
      break;
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}
