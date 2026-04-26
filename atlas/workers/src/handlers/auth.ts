import type { Env, PublicUser } from '../env';
import { err, json, sha256Hex, clientIp, clientUA } from '../lib/http';
import {
  authenticate, clearSessionCookie, createSession, destroySessionByToken,
  hashPassword, loadUserByEmail, readSessionCookie, setSessionCookie,
  verifyPassword,
} from '../lib/auth';
import { rateLimit } from '../lib/rate';

function publicUser(u: { id: string; email: string; name: string; role: string; tier: string; subscription_status: string }): PublicUser {
  return {
    id: u.id, email: u.email, name: u.name,
    role: u.role as PublicUser['role'],
    tier: u.tier as PublicUser['tier'],
    subscription_status: u.subscription_status as PublicUser['subscription_status'],
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseBody(text: string): Record<string, unknown> {
  try { return JSON.parse(text || '{}'); } catch { return {}; }
}

async function audit(env: Env, userId: string | null, action: string, details: unknown, req: Request) {
  await env.DB.prepare(
    `INSERT INTO audit_log (user_id, action, details, ip, user_agent) VALUES (?, ?, ?, ?, ?)`,
  ).bind(userId, action, JSON.stringify(details), clientIp(req), clientUA(req)).run().catch(() => {});
}

export async function handleAuth(req: Request, env: Env): Promise<Response> {
  if (req.method === 'GET') return handleVerify(req, env);
  if (req.method !== 'POST') return err(405, 'POST only', req, env);

  const body = parseBody(await req.text());
  const action = String(body.action || '');

  switch (action) {
    case 'login':    return login(req, env, body);
    case 'signup':   return signup(req, env, body);
    case 'logout':   return logout(req, env);
    case 'verify':   return handleVerify(req, env);
    case 'change-password': return changePassword(req, env, body);
    default: return err(400, 'Unknown action', req, env);
  }
}

async function login(req: Request, env: Env, body: Record<string, unknown>): Promise<Response> {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) return err(400, 'Email and password required', req, env);

  const ip = clientIp(req);
  const limit = await rateLimit(env, { key: `login:${ip}:${email}`, max: 5, windowMs: 15 * 60_000 });
  if (!limit.ok) return err(429, 'Too many login attempts. Try again later.', req, env, { retryAfterSec: limit.retryAfterSec });

  const user = await loadUserByEmail(env, email);
  if (!user) {
    // Same response time as a real attempt — don't reveal whether email exists
    await new Promise(r => setTimeout(r, 50));
    await audit(env, null, 'login_failed', { email, reason: 'not_found' }, req);
    return err(401, 'Invalid email or password', req, env);
  }

  const ok = await verifyPassword(password, user, env);
  if (!ok) {
    await audit(env, user.id, 'login_failed', { email, reason: 'bad_password' }, req);
    return err(401, 'Invalid email or password', req, env);
  }

  if (user.role === 'subscriber' && user.subscription_status !== 'active') {
    await audit(env, user.id, 'login_blocked', { reason: 'subscription_inactive' }, req);
    return err(403, 'Subscription inactive. Please renew.', req, env);
  }

  const token = await createSession(env, user.id, clientUA(req), ip);
  await audit(env, user.id, 'login_success', null, req);

  return json({ user: publicUser(user) }, {
    status: 200,
    headers: { 'Set-Cookie': setSessionCookie(token, env) },
  }, req, env);
}

async function signup(req: Request, env: Env, body: Record<string, unknown>): Promise<Response> {
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!name || !email || !password) return err(400, 'All fields required', req, env);
  if (!EMAIL_RE.test(email)) return err(400, 'Invalid email', req, env);
  if (password.length < 12) return err(400, 'Password must be at least 12 characters', req, env);
  if (password.length > 256) return err(400, 'Password too long', req, env);
  if (name.length > 80) return err(400, 'Name too long', req, env);

  const ip = clientIp(req);
  const limit = await rateLimit(env, { key: `signup:${ip}`, max: 3, windowMs: 60 * 60_000 });
  if (!limit.ok) return err(429, 'Too many signups from this IP', req, env, { retryAfterSec: limit.retryAfterSec });

  const existing = await loadUserByEmail(env, email);
  if (existing) {
    await audit(env, existing.id, 'signup_duplicate', { email }, req);
    // Generic response — don't leak whether email is registered
    return err(409, 'If this email is available we will send a confirmation', req, env);
  }

  const { hash, salt, iters } = await hashPassword(password, env);
  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO users (id, email, name, password_hash, password_salt, password_iters, role, tier, subscription_status)
     VALUES (?, ?, ?, ?, ?, ?, 'subscriber', 'core', 'pending')`,
  ).bind(id, email, name, hash, salt, iters).run();

  const user = (await loadUserByEmail(env, email))!;
  const token = await createSession(env, user.id, clientUA(req), ip);
  await audit(env, user.id, 'signup', { email }, req);
  await env.DB.prepare(
    `INSERT INTO signup_notifications (user_id, email, name) VALUES (?, ?, ?)`,
  ).bind(user.id, email, name).run().catch(() => {});

  // Best-effort owner notification (Resend) — fire and forget
  if (env.RESEND_API_KEY) {
    notifyOwners(env, name, email).catch(() => {});
  }

  return json({ user: publicUser(user) }, {
    status: 200,
    headers: { 'Set-Cookie': setSessionCookie(token, env) },
  }, req, env);
}

async function logout(req: Request, env: Env): Promise<Response> {
  const token = readSessionCookie(req);
  if (token) await destroySessionByToken(env, token);
  return json({ ok: true }, {
    headers: { 'Set-Cookie': clearSessionCookie(env) },
  }, req, env);
}

async function handleVerify(req: Request, env: Env): Promise<Response> {
  const ctx = await authenticate(req, env);
  if (!ctx) return err(401, 'Not authenticated', req, env);
  return json({ user: ctx.user }, {}, req, env);
}

async function changePassword(req: Request, env: Env, body: Record<string, unknown>): Promise<Response> {
  const ctx = await authenticate(req, env);
  if (!ctx) return err(401, 'Not authenticated', req, env);

  const current = String(body.current_password || '');
  const next = String(body.new_password || '');
  if (!current || !next) return err(400, 'Both passwords required', req, env);
  if (next.length < 12) return err(400, 'New password must be at least 12 characters', req, env);

  const user = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(ctx.user.id).first<any>();
  if (!user) return err(401, 'User not found', req, env);
  const ok = await verifyPassword(current, user, env);
  if (!ok) return err(401, 'Current password incorrect', req, env);

  const { hash, salt, iters } = await hashPassword(next, env);
  await env.DB.prepare(
    `UPDATE users SET password_hash = ?, password_salt = ?, password_iters = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
  ).bind(hash, salt, iters, ctx.user.id).run();

  // Invalidate all other sessions for this user (force re-login on other devices)
  const cur = readSessionCookie(req);
  if (cur) {
    const curHash = await sha256Hex(cur);
    await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ? AND token_hash != ?`)
      .bind(ctx.user.id, curHash).run();
  }
  await audit(env, ctx.user.id, 'password_changed', null, req);
  return json({ ok: true }, {}, req, env);
}

async function notifyOwners(env: Env, name: string, email: string): Promise<void> {
  const owners = ['kyle@atlasanalysis.net', 'scott@atlasanalysis.net', 'steve@atlasanalysis.net'];
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Atlas Analysis <notifications@atlasanalysis.net>',
      to: owners,
      subject: `New Atlas signup: ${name}`,
      html: `<p><strong>Name:</strong> ${escape(name)}</p><p><strong>Email:</strong> ${escape(email)}</p>`,
    }),
  });
  function escape(s: string) { return s.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!)); }
}
