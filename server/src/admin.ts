/**
 * Administration of the instance: its administrators are named by ADMIN_EMAILS, never chosen in the app. They see
 * every account and can disable one (sessions closed at once, sign-in refused, tasks and history kept) or enable it.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { one, query, type Row } from "./db.js";
import { bad, notFound } from "./errors.js";
import { closeUserConnections } from "./realtime.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether an account is an administrator: its address is in ADMIN_EMAILS, and proven — an e-mail account (signed in
 * by a link sent to it) or an Outline account of the configured server. Another Outline server may claim any address.
 */
export function isInstanceAdmin(u: Row | null | undefined): boolean {
  if (!u?.email || !config.adminEmails.includes(String(u.email).toLowerCase())) return false;
  if (u.auth_kind === "email") return true;
  return u.auth_kind === "outline" && Boolean(config.outlineUrl) && (u.outline_url ?? config.outlineUrl) === config.outlineUrl;
}

/** Whether the person signed in is an administrator (read again from the database, not from the session). */
export async function requestIsAdmin(req: FastifyRequest) {
  if (!req.user) return false;
  return isInstanceAdmin(await one(`SELECT email, auth_kind, outline_url FROM users WHERE id = $1`, [req.user.id]));
}

/** Disables an account: it can no longer sign in, its sessions and open pages are closed. */
export async function disableAccount(userId: string, by: string) {
  await query(`UPDATE users SET disabled_at = now(), disabled_reason = 'admin', disabled_by = $2 WHERE id = $1`, [userId, by]);
  await query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM login_tokens WHERE user_id = $1 AND used_at IS NULL`, [userId]);
  closeUserConnections(userId);
}

export async function adminRoutes(app: FastifyInstance) {
  // Unknown to everyone else: not even a "forbidden".
  app.addHook("preHandler", async (req) => {
    if (!(await requestIsAdmin(req))) throw notFound("Not found");
  });

  app.get("/admin/users", async () => {
    const { rows } = await query(
      `SELECT u.id, u.name, u.email, u.auth_kind, u.outline_url, u.last_login_at, u.created_at, u.disabled_at, u.disabled_reason,
              d.name AS disabled_by_name
       FROM users u LEFT JOIN users d ON d.id = u.disabled_by
       WHERE u.auth_kind IN ('outline', 'email') ORDER BY lower(u.name), u.created_at`
    );
    return rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      kind: u.auth_kind,
      outlineUrl: u.auth_kind === "outline" ? (u.outline_url ?? config.outlineUrl) : null,
      lastLoginAt: u.last_login_at,
      createdAt: u.created_at,
      disabled: u.disabled_at ? { at: u.disabled_at, reason: u.disabled_reason, by: u.disabled_by_name ?? null } : null,
      admin: isInstanceAdmin(u),
    }));
  });

  const target = async (req: FastifyRequest<{ Params: { id: string } }>) => {
    if (!UUID.test(req.params.id)) throw notFound("User not found");
    const u = await one(`SELECT id, email, auth_kind, outline_url, disabled_reason FROM users WHERE id = $1 AND auth_kind IN ('outline', 'email')`, [req.params.id]);
    if (!u) throw notFound("User not found");
    return u;
  };

  app.post<{ Params: { id: string } }>("/admin/users/:id/disable", async (req) => {
    const u = await target(req);
    if (u.id === req.user!.id) throw bad("You cannot disable your own account");
    if (isInstanceAdmin(u)) throw bad("An administrator cannot be disabled: remove them from ADMIN_EMAILS first");
    await disableAccount(u.id, req.user!.id);
    req.log.info({ userId: u.id, by: req.user!.id }, "Account disabled by an administrator");
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/admin/users/:id/enable", async (req) => {
    const u = await target(req);
    await query(`UPDATE users SET disabled_at = NULL, disabled_reason = NULL, disabled_by = NULL WHERE id = $1`, [u.id]);
    req.log.info({ userId: u.id, by: req.user!.id }, "Account enabled by an administrator");
    return { ok: true };
  });
}
