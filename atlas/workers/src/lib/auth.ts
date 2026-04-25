import type { Env, PublicUser, Role, Tier, UserRecord } from '../env';
import { bytesToBase64, base64ToBytes, sha256Hex, timingSafeEqual } from './http';

const PBKDF2_ITERATIONS = 210_000;
const PBKDF2_KEYLEN_BITS = 256;
const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 86_400_000;

// ── Password hashing (PBKDF2-SHA256) ────────────────────────────────────────
export async function hashPassword(plain: string, env: Env): Promise<{ hash: string; salt: string; iters: number }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iters = PBKDF2_ITERATIONS;
  const hash = await pbkdf2(plain + env.SESSION_PEPPER, salt, iters);
  return { hash: bytesToBase64(hash), salt: bytesToBase64(salt), iters };
}

export async function verifyPassword(plain: string, user: UserRecord, env: Env): Promise<boolean> {
  if (!user.password_hash || !user.password_salt) return false;
  const salt = base64ToBytes(user.password_salt);
  const expected = base64ToBytes(user.password_hash);
  const got = await pbkdf2(plain + env.SESSION_PEPPER, salt, user.password_iters || PBKDF2_ITERATIONS);
  if (got.byteLength !== expected.byteLength) return false;
  return timingSafeEqual(bytesToBase64(got), bytesToBase64(expected));
}

async function pbkdf2(password: string, salt: Uint8Array, iters: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iters },
    key, PBKDF2_KEYLEN_BITS,
  );
}

// ── Session tokens (random 32-byte hex; only hash stored) ───────────────────
export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function tokenHash(token: string): Promise<string> {
  return sha256Hex(token);
}

export async function createSession(env: Env, userId: string, ua: string, ip: string): Promise<string> {
  const token = generateSessionToken();
  const hash = await tokenHash(token);
  const id = crypto.randomUUID();
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, user_agent, ip, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(id, userId, hash, ua, ip, expires).run();
  return token;
}

export async function destroySessionByToken(env: Env, token: string): Promise<void> {
  if (!token) return;
  const hash = await tokenHash(token);
  await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(hash).run();
}

export async function destroyAllUserSessions(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId).run();
}

// ── Auth middleware ────────────────────────────────────────────────────────
const SESSION_COOKIE = 'atlas_session';

export function readSessionCookie(req: Request): string | null {
  const raw = req.headers.get('Cookie') || '';
  for (const part of raw.split(/;\s*/)) {
    const [k, v] = part.split('=');
    if (k === SESSION_COOKIE && v) return v;
  }
  // Fallback: bearer token (for API clients / tests)
  const auth = req.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

export function setSessionCookie(token: string, env: Env): string {
  const isProd = env.ENVIRONMENT !== 'development';
  return [
    `${SESSION_COOKIE}=${token}`,
    `Max-Age=${SESSION_TTL_MS / 1000}`,
    'Path=/',
    'HttpOnly',
    isProd ? 'Secure' : '',
    'SameSite=Lax',
  ].filter(Boolean).join('; ');
}

export function clearSessionCookie(env: Env): string {
  const isProd = env.ENVIRONMENT !== 'development';
  return [
    `${SESSION_COOKIE}=`,
    'Max-Age=0',
    'Path=/',
    'HttpOnly',
    isProd ? 'Secure' : '',
    'SameSite=Lax',
  ].filter(Boolean).join('; ');
}

export interface AuthContext {
  user: PublicUser;
  sessionId: string;
}

export async function authenticate(req: Request, env: Env): Promise<AuthContext | null> {
  const token = readSessionCookie(req);
  if (!token) return null;
  const hash = await tokenHash(token);
  const row = await env.DB.prepare(
    `SELECT s.id AS sid, s.expires_at, u.id, u.email, u.name, u.role, u.tier, u.subscription_status
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? LIMIT 1`,
  ).bind(hash).first<{
    sid: string; expires_at: string;
    id: string; email: string; name: string;
    role: Role; tier: Tier; subscription_status: 'pending' | 'active' | 'past_due' | 'cancelled' | 'inactive';
  }>();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(row.sid).run();
    return null;
  }
  // Touch last_seen_at (don't await — don't block request)
  env.DB.prepare(`UPDATE sessions SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
    .bind(row.sid).run().catch(() => {});

  return {
    sessionId: row.sid,
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      tier: row.tier,
      subscription_status: row.subscription_status,
    },
  };
}

export function tierLevel(t: Tier | undefined | null): number {
  switch (t) {
    case 'institutional': return 3;
    case 'pro': return 2;
    case 'core': return 1;
    default: return 0;
  }
}

export function effectiveTier(user: PublicUser | null): Tier {
  if (!user) return 'none';
  if (user.role === 'admin' || user.role === 'analyst') return 'institutional';
  if (user.subscription_status !== 'active') return 'core'; // visible-but-restricted
  return user.tier ?? 'core';
}

export function requireTier(user: PublicUser | null, min: Tier): boolean {
  return tierLevel(effectiveTier(user)) >= tierLevel(min);
}

export async function loadUserById(env: Env, id: string): Promise<UserRecord | null> {
  return env.DB.prepare(`SELECT * FROM users WHERE id = ? LIMIT 1`).bind(id).first<UserRecord>();
}

export async function loadUserByEmail(env: Env, email: string): Promise<UserRecord | null> {
  return env.DB.prepare(`SELECT * FROM users WHERE email = ? LIMIT 1`)
    .bind(email.toLowerCase().trim()).first<UserRecord>();
}
