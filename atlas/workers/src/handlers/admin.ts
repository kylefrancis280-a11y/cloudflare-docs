import type { Env } from '../env';
import { authenticate, hashPassword } from '../lib/auth';
import { err, json } from '../lib/http';

// Admin-only endpoints. Used to seed initial admin/analyst accounts (one-shot)
// and to rotate compromised passwords. Replaces the legacy `seed` Netlify function
// that shipped a hardcoded shared password hash.

export async function handleAdmin(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return err(405, 'POST only', req, env);

  const ctx = await authenticate(req, env);
  // Bootstrap exception: if there are zero admins yet, allow the first admin to be created
  // by anyone holding ADMIN_BOOTSTRAP_TOKEN (set as a one-shot secret then deleted).
  let isBootstrap = false;
  if (!ctx) {
    const token = req.headers.get('X-Admin-Bootstrap');
    const expected = (env as any).ADMIN_BOOTSTRAP_TOKEN;
    if (!token || !expected || token !== expected) return err(401, 'auth required', req, env);
    const adminCount = await env.DB.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin'`).first<{ n: number }>();
    if ((adminCount?.n ?? 0) > 0) return err(403, 'admin already exists; bootstrap disabled', req, env);
    isBootstrap = true;
  } else if (ctx.user.role !== 'admin') {
    return err(403, 'admin only', req, env);
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action || '');

  switch (action) {
    case 'create-staff': {
      const email = String(body.email || '').toLowerCase().trim();
      const name = String(body.name || '').trim();
      const password = String(body.password || '');
      const role = String(body.role || 'analyst');
      if (!['admin', 'analyst'].includes(role)) return err(400, 'role must be admin or analyst', req, env);
      if (!email || !name || password.length < 16) return err(400, 'email/name required, password >= 16 chars', req, env);
      const existing = await env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(email).first();
      if (existing) return err(409, 'user exists', req, env);
      const { hash, salt, iters } = await hashPassword(password, env);
      const id = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO users (id, email, name, password_hash, password_salt, password_iters, role, tier, subscription_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'institutional', 'active')`,
      ).bind(id, email, name, hash, salt, iters, role).run();
      return json({ ok: true, id, bootstrap: isBootstrap }, {}, req, env);
    }
    case 'force-reset-password': {
      const email = String(body.email || '').toLowerCase().trim();
      const password = String(body.password || '');
      if (!email || password.length < 16) return err(400, 'email + password (>=16) required', req, env);
      const u = await env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(email).first<{ id: string }>();
      if (!u) return err(404, 'user not found', req, env);
      const { hash, salt, iters } = await hashPassword(password, env);
      await env.DB.prepare(
        `UPDATE users SET password_hash=?, password_salt=?, password_iters=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
      ).bind(hash, salt, iters, u.id).run();
      await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(u.id).run();
      return json({ ok: true }, {}, req, env);
    }
    case 'list-users': {
      const rows = await env.DB.prepare(
        `SELECT id, email, name, role, tier, subscription_status, created_at FROM users ORDER BY created_at DESC LIMIT 200`,
      ).all();
      return json({ users: rows.results ?? [] }, {}, req, env);
    }
    case 'audit-tail': {
      const limit = Math.min(200, Math.max(1, Number(body.limit) || 50));
      const rows = await env.DB.prepare(
        `SELECT id, user_id, action, details, ip, created_at FROM audit_log ORDER BY id DESC LIMIT ?`,
      ).bind(limit).all();
      return json({ events: rows.results ?? [] }, {}, req, env);
    }
    default: return err(400, 'unknown action', req, env);
  }
}
