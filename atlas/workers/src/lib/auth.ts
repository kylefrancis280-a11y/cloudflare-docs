/// <reference types="@cloudflare/workers-types" />
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
    key, PBKDF2_KEYLEN_BITS
  );
}

// ── Session tokens ───────────────────────────────────────────────────────────
export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function tokenHash(token: string): Promise<string> {
  return sha256Hex(token);
}

// ... (rest of the file stays exactly the same - I didn't change the session or auth middleware)

export async function createSession(env: Env, userId: string, ua: string, ip: string): Promise<string> {
  const token = generateSessionToken();
  const hash = await tokenHash(token);
  const id = crypto.randomUUID();
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, user_agent, ip, expires_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, userId, hash, ua, ip, expires).run();

  return token;
}

// ... (all the rest of your auth middleware, authenticate(), tierLevel(), etc. stays 100% the same)

export async function loadUserById(env: Env, id: string): Promise<UserRecord | null> {
  return env.DB.prepare(`SELECT * FROM users WHERE id = ? LIMIT 1`).bind(id).first<UserRecord>();
}

export async function loadUserByEmail(env: Env, email: string): Promise<UserRecord | null> {
  return env.DB.prepare(`SELECT * FROM users WHERE email = ? LIMIT 1`)
    .bind(email.toLowerCase().trim()).first<UserRecord>();
}
