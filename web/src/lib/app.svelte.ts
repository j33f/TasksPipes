import { api } from "./api";
import { setParams } from "./router.svelte";
import type { Column, Me, PipeType, SidebarData, SpaceSummary, Task, TaskType, User, UserRef } from "./types";

class AppState {
  me = $state<Me | null | undefined>(undefined);
  spaces = $state<SpaceSummary[]>([]);
  users = $state<User[]>([]);
  pipeTypes = $state<PipeType[]>([]);
  taskTypes = $state<TaskType[]>([]);
  sidebar = $state<SidebarData>({ mine: [], pinned: [], teams: [] });
  /** Bumped after every mutation so pages reload their data. */
  version = $state(0);
  toastMessage = $state<{ message: string; type: "info" | "error"; id: number; action?: { label: string; run: () => void } } | null>(null);

  /** Account invited by e-mail: no Outline access, may enable TOTP. */
  isGuest = $derived(this.me?.user.kind === "email");
  /** Dialog opened from the user menu (or the dashboard, notifications…). */
  dialog = $state<"settings" | "calendar" | "about" | "invite" | null>(null);
  /** Tasks waiting in my incoming and in my teams' ones. */
  pendingCount = $derived(
    this.spaces.filter((s) => s.myRole && (s.id === this.me?.personalSpaceId || s.kind === "team"))
      .reduce((n, s) => n + (s.incomingCount ?? 0), 0)
  );
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
    const [spaces, users, catalog, sidebar] = await Promise.all([
      api.get<SpaceSummary[]>("/spaces"),
      api.get<User[]>("/users"),
      this.pipeTypes.length
        ? { pipeTypes: this.pipeTypes, taskTypes: this.taskTypes }
        : api.get<{ pipeTypes: PipeType[]; taskTypes: TaskType[] }>("/catalog"),
      api.get<SidebarData>("/sidebar"),
    ]);
    this.spaces = spaces;
    this.users = users;
    this.pipeTypes = catalog.pipeTypes;
    this.taskTypes = catalog.taskTypes;
    this.sidebar = sidebar;
  }

  /** Whether I may choose a type: built-in, public, or mine. */
  usable(t: { custom?: true; visibility?: string; createdBy?: { id: string } | null }): boolean {
    return !t.custom || t.visibility !== "private" || t.createdBy?.id === this.me?.user.id;
  }

  /** Whether a type is offered to me in pickers: usable and not turned off. */
  offered(t: { custom?: true; visibility?: string; createdBy?: { id: string } | null; disabled?: boolean }): boolean {
    return this.usable(t) && !t.disabled;
  }

  /** Turns a pipe type off or on for me (its task types follow), then reloads the catalog. */
  async setPipeTypeDisabled(id: string, disabled: boolean) {
    const off = this.pipeTypes.filter((p) => p.disabled && p.id !== id).map((p) => p.id);
    await api.put("/me/disabled-pipe-types", { pipeTypes: disabled ? [...off, id] : off });
    await this.loadCatalog();
  }

  /** Category of a task type: its own, or that of the first built-in pipe type offering it. */
  taskTypeGroup(t: TaskType): string {
    return t.group ?? this.pipeTypes.find((p) => !p.custom && p.taskTypes.includes(t.id))?.group ?? this.pipeType("general")?.group ?? "General";
  }

  /** Reloads pipe and task types (after a change in the designer). */
  async loadCatalog() {
    const catalog = await api.get<{ pipeTypes: PipeType[]; taskTypes: TaskType[] }>("/catalog");
    this.pipeTypes = catalog.pipeTypes;
    this.taskTypes = catalog.taskTypes;
  }

  /** Board columns of a pipe type. */
  columnsFor(kind: string | null | undefined): Column[] {
    return (this.pipeType(kind) ?? this.pipeType("general"))?.columns ?? [];
  }

  /** The column a task is in, if it sits in a pipe. */
  columnOf(task: Pick<Task, "stage" | "pipe">): Column | undefined {
    return task.pipe ? this.columnsFor(task.pipe.kind).find((c) => c.id === task.stage) : undefined;
  }

  taskType(id: string | null | undefined): TaskType | undefined {
    return this.taskTypes.find((t) => t.id === id);
  }

  /** Task types offered in a pipe of this type: the plain task first. */
  taskTypesFor(kind: string | null | undefined): TaskType[] {
    const ids = ["task", ...(this.pipeType(kind)?.taskTypes ?? [])];
    return ids.map((id) => this.taskType(id)).filter((t): t is TaskType => Boolean(t));
  }

  isPinned(pipeId: string): boolean {
    return this.sidebar.pinned.some((p) => p.id === pipeId);
  }

  async setPinned(pipeId: string, pinned: boolean) {
    if (pinned) await api.put(`/pipes/${pipeId}/pin`);
    else await api.del(`/pipes/${pipeId}/pin`);
    this.sidebar = await api.get<SidebarData>("/sidebar");
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
  toast(message: string, type: "info" | "error" = "info", action?: { label: string; run: () => void }) {
    this.toastMessage = { message, type, id: Date.now(), action };
    clearTimeout(this.#toastTimer);
    this.#toastTimer = setTimeout(() => (this.toastMessage = null), action ? 8000 : 3500);
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
