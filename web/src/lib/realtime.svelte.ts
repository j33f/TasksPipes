import { app } from "./app.svelte";
import { t } from "./i18n.svelte";
import { checkServerVersion } from "./version.svelte";

/** Closed after this long without any activity on the page, or this long after the page is hidden. */
const IDLE_MS = 5 * 60_000;
const HIDDEN_MS = 60_000;

interface LiveEvent {
  type: "task.sent" | "task.refused" | "incoming.changed" | "connection.request" | "connection.accepted" | "mention" | "unblocked" | "hello";
  /** "hello": version of the server. */
  version?: string;
  spaceId?: string;
  task?: { id: string; number: number; title: string };
  by?: string;
  reason?: string;
}

/**
 * Live updates: tasks sent to me or to my teams, and refused tasks coming back.
 * The socket only stays open while someone is using the page; on return it reopens and the data is reloaded.
 */
class Live {
  connected = $state(false);
  /** Closed on purpose (inactivity, hidden page, logout): no reconnecting until there is activity. */
  idle = $state(false);
  /** Bumped on each arrival, to animate the badge. */
  arrivals = $state(0);

  #ws: WebSocket | null = null;
  #retry = 0;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;
  #hiddenTimer: ReturnType<typeof setTimeout> | undefined;
  #idleTimer: ReturnType<typeof setInterval> | undefined;
  #lastActivity = Date.now();
  #started = false;

  start() {
    if (this.#started) return;
    this.#started = true;
    this.idle = false;
    this.#lastActivity = Date.now();
    for (const e of ["pointerdown", "keydown", "scroll", "touchstart", "mousemove", "focus"]) {
      window.addEventListener(e, this.#onActivity, { passive: true, capture: true });
    }
    document.addEventListener("visibilitychange", this.#onVisibility);
    this.#idleTimer = setInterval(() => {
      if (this.#ws && Date.now() - this.#lastActivity > IDLE_MS) this.#sleep();
    }, 30_000);
    this.#connect();
  }

  stop() {
    this.#started = false;
    for (const e of ["pointerdown", "keydown", "scroll", "touchstart", "mousemove", "focus"]) {
      window.removeEventListener(e, this.#onActivity, { capture: true });
    }
    document.removeEventListener("visibilitychange", this.#onVisibility);
    clearInterval(this.#idleTimer);
    this.#sleep();
  }

  #onActivity = () => {
    this.#lastActivity = Date.now();
    if (this.idle && !document.hidden) this.#wake();
  };

  #onVisibility = () => {
    clearTimeout(this.#hiddenTimer);
    if (document.hidden) this.#hiddenTimer = setTimeout(() => this.#sleep(), HIDDEN_MS);
    else this.#onActivity();
  };

  /** Back from idle: reconnect and catch up on what happened meanwhile. */
  #wake() {
    this.idle = false;
    this.#retry = 0;
    this.#connect();
    app.refresh();
  }

  #sleep() {
    this.idle = true;
    clearTimeout(this.#retryTimer);
    const ws = this.#ws;
    this.#ws = null;
    ws?.close(1000);
    this.connected = false;
  }

  #connect() {
    if (this.#ws || !app.me) return;
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/events`);
    this.#ws = ws;
    ws.onopen = () => {
      this.connected = true;
      // A reconnection after a failure may have missed events.
      if (this.#retry > 0) app.refresh();
      this.#retry = 0;
    };
    ws.onmessage = (m) => {
      try {
        this.#handle(JSON.parse(m.data));
      } catch {
        /* ignore malformed messages */
      }
    };
    ws.onclose = (e) => {
      if (this.#ws !== ws) return; // closed on purpose
      this.#ws = null;
      this.connected = false;
      if (e.code === 4401) return app.init(); // session gone
      // Unexpected close: retry with backoff while the page is in use.
      const delay = Math.min(30_000, 1000 * 2 ** this.#retry++);
      this.#retryTimer = setTimeout(() => !this.idle && this.#connect(), delay);
    };
  }

  #handle(e: LiveEvent) {
    if (e.type === "hello") return checkServerVersion(e.version);
    app.refresh();
    if (e.type === "connection.request") {
      return app.toast(t("{name} wants to connect with you", { name: e.by ?? "" }), "info", { label: t("View"), run: () => (app.dialog = "settings") });
    }
    if (e.type === "connection.accepted") return app.toast(t("{name} accepted to connect with you", { name: e.by ?? "" }));
    if (e.type === "mention" && e.task) {
      const task = e.task;
      return app.toast(t("{name} mentioned you in “{title}”", { name: e.by ?? "", title: task.title }), "info", { label: t("View"), run: () => app.openTask(task.id) });
    }
    if (e.type === "unblocked" && e.task) {
      const task = e.task;
      return app.toast(t("“{title}” is no longer blocked", { title: task.title }), "info", { label: t("View"), run: () => app.openTask(task.id) });
    }
    if (e.type === "incoming.changed" || !e.task) return;
    this.arrivals++;
    const task = e.task;
    const where = app.spaces.find((s) => s.id === e.spaceId);
    const message =
      e.type === "task.sent"
        ? where?.kind === "team"
          ? t("{name} sends “{title}” to the team {team}", { name: e.by ?? "", title: task.title, team: where.name })
          : t("{name} sends you “{title}”", { name: e.by ?? "", title: task.title })
        : e.reason
          ? t("{name} refused “{title}”: {reason}", { name: e.by ?? "", title: task.title, reason: e.reason.slice(0, 80) })
          : t("{name} refused “{title}”", { name: e.by ?? "", title: task.title });
    app.toast(message, "info", { label: t("View"), run: () => app.openTask(task.id) });
  }
}

export const live = new Live();
