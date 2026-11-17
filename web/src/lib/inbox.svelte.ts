/**
 * In-app notifications (the bell): the unread ones, kept fresh by the live connection ("inbox" events) and
 * reloaded when the page comes back. Marking one as read takes it out of the list at once.
 */
import { api } from "./api";
import type { InboxItem } from "./types";

class Inbox {
  items = $state<InboxItem[]>([]);
  unread = $state(0);
  /** Bumped when new notifications arrive, so that the pastille pulses. */
  arrivals = $state(0);
  loaded = $state(false);
  #loading: Promise<void> | null = null;

  /** Loads the unread notifications (one request at a time). */
  load(): Promise<void> {
    this.#loading ??= api
      .get<{ items: InboxItem[]; unread: number }>("/inbox")
      .then((r) => {
        if (r.unread > this.unread && this.loaded) this.arrivals++;
        this.items = r.items;
        this.unread = r.unread;
        this.loaded = true;
      })
      .catch(() => {})
      .finally(() => (this.#loading = null));
    return this.#loading;
  }

  /** Marks some notifications as read (all of them without ids); undone if the server refuses. */
  async markRead(ids?: number[]) {
    const gone = ids ? new Set(ids) : null;
    const before = { items: this.items, unread: this.unread };
    this.items = gone ? this.items.filter((i) => !gone.has(i.id)) : [];
    this.unread = gone ? Math.max(0, this.unread - before.items.filter((i) => gone.has(i.id)).length) : 0;
    try {
      const r = await api.post<{ unread: number }>("/inbox/read", ids ? { ids } : {});
      this.unread = r.unread;
    } catch (err) {
      this.items = before.items;
      this.unread = before.unread;
      throw err;
    }
  }

  reset() {
    this.items = [];
    this.unread = 0;
    this.loaded = false;
  }
}

export const inbox = new Inbox();
