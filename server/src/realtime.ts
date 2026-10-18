/**
 * Live notifications over WebSocket (GET /api/events), authenticated by the session cookie.
 * The page closes its socket when left idle and reopens it on return; nothing is queued meanwhile:
 * on reconnecting, the page reloads its data.
 */
import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import type { WebSocket } from "@fastify/websocket";
import { config } from "./config.js";
import { query } from "./db.js";

const sockets = new Map<string, Set<WebSocket>>();
const alive = new WeakSet<WebSocket>();

export interface LiveEvent {
  /** task.sent: a task arrived in an incoming bucket; task.refused: one came back; incoming.changed: one left. */
  type: "task.sent" | "task.refused" | "incoming.changed" | "task.updated" | "connection.request" | "connection.accepted" | "mention" | "hello";
  spaceId?: string;
  task?: { id: string; number: number; title: string };
  by?: string;
  reason?: string;
}

export async function realtime(app: FastifyInstance) {
  await app.register(websocket, { options: { maxPayload: 1024 } });

  app.get("/api/events", { websocket: true }, (socket, req) => {
    // Same-origin pages only, and signed in.
    const origin = req.headers.origin;
    if (!req.user || (origin && origin !== new URL(config.appUrl).origin)) {
      socket.close(4401, "unauthorized");
      return;
    }
    const userId = req.user.id;
    let set = sockets.get(userId);
    if (!set) sockets.set(userId, (set = new Set()));
    set.add(socket);
    alive.add(socket);
    socket.on("pong", () => alive.add(socket));
    // First message: the server's version, so pages left open across an update notice it.
    socket.send(JSON.stringify({ type: "hello", version: config.version }));
    socket.on("message", () => {}); // nothing is expected from the page
    socket.on("close", () => {
      set!.delete(socket);
      if (!set!.size) sockets.delete(userId);
    });
  });

  // Drops connections that stopped answering (sleeping phone, lost network).
  const timer = setInterval(() => {
    for (const set of sockets.values()) {
      for (const s of set) {
        if (!alive.has(s)) {
          s.terminate();
          continue;
        }
        alive.delete(s);
        s.ping();
      }
    }
  }, 30_000);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));
}

/** Notifies one person (all their open pages). */
export function notifyUser(userId: string, event: LiveEvent) {
  const message = JSON.stringify(event);
  for (const s of sockets.get(userId) ?? []) if (s.readyState === s.OPEN) s.send(message);
}

/** Notifies the members of a space (but not the person who acted). Never throws. */
export async function notifySpace(spaceId: string, event: Omit<LiveEvent, "spaceId">, exceptUserId?: string) {
  if (!sockets.size) return;
  try {
    const { rows } = await query(`SELECT user_id FROM space_members WHERE space_id = $1`, [spaceId]);
    const message = JSON.stringify({ ...event, spaceId });
    for (const { user_id } of rows) {
      if (user_id === exceptUserId) continue;
      for (const s of sockets.get(user_id) ?? []) if (s.readyState === s.OPEN) s.send(message);
    }
  } catch {
    // Live updates are a convenience: the page also reloads its data when it comes back.
  }
}

/** Closes the open pages of someone whose access ended (disabled, deleted, signed out by Outline). */
export function closeUserConnections(userId: string) {
  for (const s of sockets.get(userId) ?? []) s.close(4401, "unauthorized");
  sockets.delete(userId);
}

/** Whether someone has a page of the app open and in use (pages close their connection when left idle). */
export const isOnline = (userId: string) => (sockets.get(userId)?.size ?? 0) > 0;
