import { api } from "./api";

/** Who edits a task (server/src/locks.ts). */
export interface LockState {
  holder: { id: string; name: string; avatarUrl: string | null } | null;
  /** This page holds it. */
  mine: boolean;
  claim: { by: { id: string; name: string }; mine: boolean; secondsLeft: number } | null;
}

/** This tab, among the pages of the same person (a lock belongs to one page). */
export const CLIENT_ID = (crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "");

/** A page keeps its lock by saying so this often (the server forgets it after 90 s). */
const KEEP_MS = 20_000;

/**
 * The editing lock of the task shown in a page: taken on opening when nobody holds it (and the page may edit), kept
 * while it stays open, released on closing. The others see who holds it and may claim it.
 */
export class TaskLock {
  state = $state<LockState | null>(null);
  /** Seconds left to answer a claim, counted down here between two answers of the server. */
  secondsLeft = $state(0);
  /** Called on each new state, with the one before (null at first). */
  onchange: ((before: LockState | null, after: LockState) => void) | null = null;

  #taskId: string;
  #canEdit = false;
  #timer: ReturnType<typeof setInterval> | undefined;
  #tick: ReturnType<typeof setInterval> | undefined;
  #due: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;

  constructor(taskId: string) {
    this.#taskId = taskId;
  }

  /** Someone else edits it: this page shows it read-only. */
  get lockedByOther() {
    return Boolean(this.state?.holder) && !this.state!.mine;
  }

  start(canEdit: boolean) {
    this.#canEdit = canEdit;
    this.#stopped = false;
    clearInterval(this.#timer);
    this.#timer = setInterval(() => this.refresh(), KEEP_MS);
    window.addEventListener("pagehide", this.#onLeave);
    return this.refresh();
  }

  stop() {
    this.#stopped = true;
    clearInterval(this.#timer);
    clearInterval(this.#tick);
    clearTimeout(this.#due);
    window.removeEventListener("pagehide", this.#onLeave);
    this.#release();
  }

  /** Takes or keeps it (a page that may edit), or reads who holds it. */
  async refresh() {
    if (this.#stopped) return;
    const path = `/tasks/${this.#taskId}/lock`;
    try {
      this.#set(this.#canEdit ? await api.put<LockState>(path, { client: CLIENT_ID }) : await api.get<LockState>(`${path}?client=${CLIENT_ID}`));
    } catch {
      /* next time */
    }
  }

  /** Asks the one who holds it to hand it over. */
  async claim() {
    this.#set(await api.post<LockState>(`/tasks/${this.#taskId}/lock/claim`, { client: CLIENT_ID }));
  }

  /** The holder's answer to a claim. */
  async answer(accept: boolean) {
    this.#set(await api.post<LockState>(`/tasks/${this.#taskId}/lock/answer`, { client: CLIENT_ID, accept }));
  }

  #set(s: LockState) {
    if (this.#stopped) return;
    const before = this.state;
    this.state = s;
    this.onchange?.(before, s);
    clearInterval(this.#tick);
    clearTimeout(this.#due);
    if (!s.claim) return;
    this.secondsLeft = s.claim.secondsLeft;
    this.#tick = setInterval(() => (this.secondsLeft = Math.max(0, this.secondsLeft - 1)), 1000);
    // Unanswered: asked again once the delay is over, for the server to hand it over.
    this.#due = setTimeout(() => this.refresh(), (s.claim.secondsLeft + 1) * 1000);
  }

  #onLeave = () => this.#release();

  #release() {
    if (!this.state?.mine && !this.state?.claim?.mine) return;
    // Sent even while the page goes away.
    fetch(`/api/tasks/${this.#taskId}/lock?client=${CLIENT_ID}`, { method: "DELETE", credentials: "same-origin", keepalive: true }).catch(() => {});
  }
}
