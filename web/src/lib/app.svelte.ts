import { api } from "./api";
import { setParams } from "./router.svelte";
import type { Me, PipeType, SpaceSummary, User, UserRef } from "./types";

class AppState {
  me = $state<Me | null | undefined>(undefined);
  spaces = $state<SpaceSummary[]>([]);
  users = $state<User[]>([]);
  pipeTypes = $state<PipeType[]>([]);
  /** Bumped after every mutation so pages reload their data. */
  version = $state(0);
  toastMessage = $state<{ message: string; type: "info" | "error"; id: number } | null>(null);

  personalSpace = $derived(this.spaces.find((s) => s.id === this.me?.personalSpaceId) ?? null);
  myTeams = $derived(this.spaces.filter((s) => s.kind === "team" && s.myRole));
  otherTeams = $derived(this.spaces.filter((s) => s.kind === "team" && !s.myRole));
  people = $derived(this.spaces.filter((s) => s.kind === "user" && s.id !== this.me?.personalSpaceId));

  #listening = false;
  async init() {
    if (!this.#listening) {
      window.addEventListener("tp:unauthorized", () => (this.me = null));
      this.#listening = true;
    }
    try {
      this.me = await api.get<Me>("/me");
    } catch {
      this.me = null;
    }
  }

  async loadShared() {
    if (!this.me) return;
    const [spaces, users, pipeTypes] = await Promise.all([
      api.get<SpaceSummary[]>("/spaces"),
      api.get<User[]>("/users"),
      this.pipeTypes.length ? this.pipeTypes : api.get<PipeType[]>("/pipe-types"),
    ]);
    this.spaces = spaces;
    this.users = users;
    this.pipeTypes = pipeTypes;
  }

  pipeType(id: string | null | undefined): PipeType | undefined {
    return this.pipeTypes.find((t) => t.id === id);
  }

  /** Members of a team space (possible owners of its tasks); empty for a personal space. */
  async teamMembers(spaceId: string | null | undefined): Promise<UserRef[]> {
    if (!spaceId || this.spaces.find((s) => s.id === spaceId)?.kind !== "team") return [];
    return (await api.get<{ members: UserRef[] }>(`/spaces/${spaceId}`)).members;
  }

  refresh() {
    this.version++;
    this.loadShared().catch(() => {});
  }

  #toastTimer: ReturnType<typeof setTimeout> | undefined;
  toast(message: string, type: "info" | "error" = "info") {
    this.toastMessage = { message, type, id: Date.now() };
    clearTimeout(this.#toastTimer);
    this.#toastTimer = setTimeout(() => (this.toastMessage = null), 3500);
  }

  openTask(id: string | null) {
    setParams({ task: id });
  }

  async logout() {
    await api.post("/auth/logout").catch(() => {});
    this.me = null;
  }
}

export const app = new AppState();
