export type Status = "backlog" | "ready" | "started" | "ongoing" | "blocked" | "abandoned" | "done";

export interface UserRef {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

export interface User extends UserRef {
  spaceId: string;
  active: boolean;
  /** Invited by e-mail. */
  guest: boolean;
}

export interface Me {
  user: UserRef & {
    email: string | null;
    kind: "outline" | "email" | "oidc";
    totp: boolean;
    /** Chosen language and theme; null follows the browser / the system. */
    locale: string | null;
    theme: "light" | "dark" | null;
  };
  personalSpaceId: string;
  outlineUrl: string;
  /** Administrator of the instance (ADMIN_EMAILS): the administration page is offered. */
  admin?: boolean;
  /** What this instance allows. */
  features: { invitations: boolean; notifications: boolean; outline?: boolean };
  /** E-mail notification choices, when e-mail is set up on the instance. */
  notificationPrefs?: NotificationPrefs;
}

export type NotificationMode = "immediate" | "digest" | "off";
export type NotificationKind = "received" | "assigned" | "refused" | "comment" | "mention" | "unblocked" | "due";
export type NotificationPrefs = Record<NotificationKind, NotificationMode> & { dueHour: number };

export interface SpaceSummary {
  id: string;
  kind: "user" | "team";
  userId: string | null;
  name: string;
  description: string;
  color: string | null;
  avatarUrl: string | null;
  active: boolean;
  guest: boolean;
  myRole: "admin" | "member" | null;
  memberCount: number;
  incomingCount: number | null;
  pipeCount: number;
}

export interface Pipe {
  id: string;
  spaceId: string;
  name: string;
  description: string;
  visibility: "private" | "open";
  kind: string;
  /** Icon name or emoji; null means the default icon of the pipe type. */
  icon: string | null;
  archived: boolean;
  /** The classic pipe every personal space has; it cannot be archived or deleted. */
  isDefault: boolean;
  color: string | null;
  createdBy: UserRef | null;
  counts: Partial<Record<Status, number>>;
  /** Reports sent by e-mail at the report hour: daily activity, weekly time (development pipes). */
  dailyReport: boolean;
  weeklyReport: boolean;
}

export interface Member extends UserRef {
  role: "admin" | "member";
  /** Disabled by an administrator of the instance. */
  disabled?: boolean;
}

export interface SpaceDetail extends Omit<SpaceSummary, "memberCount" | "incomingCount" | "pipeCount" | "active"> {
  members: Member[];
  pipes: Pipe[];
  incoming: Task[] | null;
}

export interface DocRef {
  id: string;
  title: string;
  url: string | null;
}

export interface Task {
  id: string;
  number: number;
  title: string;
  description: string;
  status: Status;
  /** Board column (depends on the pipe type); null in an incoming bucket. */
  stage: string | null;
  taskType: string;
  fields: Record<string, unknown>;
  position: number;
  dueDate: string | null;
  space: { id: string; name: string; kind: "user" | "team" };
  pipe: { id: string; name: string; visibility: "private" | "open"; kind: string } | null;
  inIncoming: boolean;
  author: UserRef;
  assignee: UserRef | null;
  sender: UserRef | null;
  outlineDoc: DocRef | null;
  commentCount: number;
  /** State of the latest pull/merge request naming the task. */
  gitState: TaskLink["state"] | null;
  /** Sub-tasks: how many, how many checked, and the first one left. */
  checklist: { total: number; done: number; next: { id: string; text: string } | null };
  /** Tasks it waits for, still to finish. */
  blockers: number;
  /** 1 urgent, 2 high, 3 medium, 4 low; null for none. */
  priority: Priority | null;
  /** Labels of its space. */
  labels: Label[];
  /** Estimate and time logged by hand, in minutes. */
  estimateMinutes: number | null;
  loggedMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export type Priority = 1 | 2 | 3 | 4;

export interface Label {
  id: string;
  name: string;
  color: string;
  position?: number;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  position: number;
  doneAt?: string | null;
  doneBy?: string | null;
}

export interface EventSide {
  location: { spaceId: string; spaceName: string; pipeId: string | null; pipeName: string | null; incoming: boolean } | null;
  status: Status | null;
  /** Column label at the time of the event. */
  stage: string | null;
  assignee: UserRef | null;
  dueDate: string | null;
  doc: DocRef | null;
}

export interface TaskEvent {
  id: number;
  type: "created" | "sent" | "accepted" | "moved" | "status" | "refused" | "updated" | "edited" | "comment" | "fields" | "file" | "checklist" | "linked" | "dependency" | "time";
  comment: string | null;
  details: {
    fields?: string[];
    taskType?: { from: string; to: string };
    added?: string;
    removed?: string;
    field?: string;
    item?: string;
    done?: boolean;
    /** Pull/merge request or commit (events "linked", and moves made by GitHub / GitLab). */
    provider?: "github" | "gitlab";
    kind?: TaskLink["kind"];
    url?: string;
    number?: number | null;
    title?: string;
    repo?: string;
    action?: string;
    /** A task it waits for was added or removed (event "dependency"). */
    dependency?: "added" | "removed";
    /** Moved forward while it still waited for other tasks. */
    whileBlocked?: boolean;
    priority?: { from: Priority | null; to: Priority | null };
    labels?: { added: string[]; removed: string[] };
    estimate?: { from: number | null; to: number | null };
    /** A team admin deleted someone else's time entry (event "time"). */
    timeRemoved?: { minutes: number; spentOn: string; of: string | null };
  } | null;
  createdAt: string;
  actor: UserRef;
  from: EventSide;
  to: EventSide;
}

export interface TaskDetail extends Task {
  permissions: { view: boolean; manage: boolean; editContent: boolean; comment: boolean; refuse: boolean };
  events: TaskEvent[];
  files: TaskFile[];
  items: ChecklistItem[];
  /** Key to name the task in branches, PR/MR titles and commits (TP-123). */
  key: string;
  links: TaskLink[];
  /** The task's pipe is connected to GitHub or GitLab. */
  gitConnected: boolean;
  timing: Timing;
  /** Its repetition, when it belongs to a recurring series. */
  recurrence: Recurrence | null;
  /** Tasks it waits for, and tasks waiting for it. */
  blockedBy: Dependency[];
  blocks: Dependency[];
}

/**
 * A task linked to another one. One that cannot be opened shows only its title and owner (no id, except a blocker,
 * to unlink it); a confidential or team-only one nothing at all (masked).
 */
export interface Dependency {
  id?: string;
  number?: number;
  title?: string;
  status?: Status;
  owner?: { id?: string; name: string } | null;
  resolved: boolean;
  visible: boolean;
  masked?: boolean;
}

export interface TaskFile {
  id: string;
  field: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
  uploadedBy: string;
}

export interface PipeDetail extends Pipe {
  space: { id: string; name: string; kind: "user" | "team"; userId: string | null; avatarUrl: string | null; color: string | null };
  myRole: string | null;
  canManage: boolean;
  canAddTasks: boolean;
  tasks: Task[];
}

export interface SidebarPipe extends Pipe {
  spaceName?: string;
  canManage: boolean;
}

export interface SidebarData {
  mine: SidebarPipe[];
  pinned: SidebarPipe[];
  /** Pipes of my teams. */
  teams: SidebarPipe[];
}

export interface Column {
  id: string;
  label: string;
  color: string;
  status: Status;
  /** Work in progress limit: the board warns when the column holds more tasks. */
  wipLimit?: number;
}

export type FieldType =
  | "text" | "textarea" | "number" | "money" | "date" | "url" | "email" | "phone"
  | "select" | "multiselect" | "checkbox" | "user" | "rncp" | "docs" | "files";

export interface Field {
  id: string;
  label: string;
  type: FieldType;
  /** Stored values of a select / multiselect field… */
  options?: string[];
  /** …and how they read in the current language (built-in types). */
  optionLabels?: string[];
  hint?: string;
}

/** Set on types made with the designer. */
export interface CustomMeta {
  custom?: true;
  /** Private: offered only to its author. */
  visibility?: "private" | "public";
  /** Turned off by me (pipe type), or offered only by pipe types I turned off (task type). */
  disabled?: boolean;
  createdBy?: { id: string; name: string } | null;
  updatedAt?: string;
}

export interface TaskType extends CustomMeta {
  id: string;
  label: string;
  group?: string;
  icon: string;
  description: string;
  fields: Field[];
}

export interface RncpValue {
  code: string | null;
  title: string | null;
}

export interface PipeType extends CustomMeta {
  id: string;
  label: string;
  group: string;
  description: string;
  color: string;
  icon: string;
  columns: Column[];
  taskTypes: string[];
  /** Sensitive personal data: never open to everyone. */
  confidential?: boolean;
  /** Reserved to a team space; its tasks never leave it. */
  teamOnly?: boolean;
  /** Development pipes: a weekly time report can be sent. */
  timeReport?: boolean;
  templates: string[];
}

export interface OutlineDoc extends DocRef {
  updatedAt?: string;
}

export interface Invitation {
  id: string;
  name: string;
  /** Only for the people I invited. */
  email: string | null;
  active: boolean;
  /** Invited by me, never signed in and the link expired: the account is disabled until a new link is sent. */
  expired: boolean;
  invitedByMe: boolean;
  avatarUrl: string | null;
  /** A person already on the platform answers the request; a new address is accepted at once. */
  status: "pending" | "accepted" | "refused";
  createdAt: string;
}

/** A pull/merge request or a commit naming a task. */
export interface TaskLink {
  provider: "github" | "gitlab";
  kind: "pull_request" | "merge_request" | "commit";
  url: string;
  number: number | null;
  title: string;
  state: "draft" | "open" | "merged" | "closed" | "pushed";
  repo: string;
  author: string | null;
  updatedAt: string;
}

export interface GitIntegration {
  provider: "github" | "gitlab";
  /** Webhook URL to give to GitHub / GitLab, and its secret. */
  url: string;
  secret: string;
  createdAt: string;
  lastEventAt: string | null;
}

/** Time spent per step of a task (computed from its history). */
export interface Timing {
  steps: { label: string | null; incoming: boolean; status: Status | null; ms: number }[];
  current: { label: string | null; incoming: boolean; since: string } | null;
  leadMs: number;
  cycleMs: number | null;
  done: boolean;
}

export interface ReportTask {
  id: string;
  number: number;
  title: string;
  taskType: string;
  owner: string | null;
  stage?: string | null;
}

interface ReportPeriod {
  /** Local day the report ends on, at `hour` in `timezone`. */
  day: string;
  hour: number;
  timezone: string;
  period: { start: string; end: string };
}

export interface DailyReport extends ReportPeriod {
  created: ReportTask[];
  started: ReportTask[];
  done: ReportTask[];
  blocked: ReportTask[];
  dropped: ReportTask[];
  inProgress: ReportTask[];
  stillBlocked: ReportTask[];
}

export interface TimeEntry {
  id: string;
  user: UserRef;
  spentOn: string;
  minutes: number;
  note: string;
  createdAt: string;
  mine: boolean;
  canDelete: boolean;
}

export interface WeeklyReport extends ReportPeriod {
  logged?: {
    totalMinutes: number;
    byPerson: { name: string; minutes: number }[];
    tasks: (ReportTask & { minutes: number; estimateMinutes: number | null; totalMinutes: number })[];
  };
  byType: { taskType: string; activeMs: number; blockedMs: number; tasks: number; done: number }[];
  tasks: (ReportTask & { activeMs: number; blockedMs: number; done: boolean })[];
  totalActiveMs: number;
}

/** A task found by the global search (GET /api/search). */
export interface SearchResult {
  id: string;
  number: number;
  key: string;
  title: string;
  status: Status;
  taskType: string;
  space: { id: string; name: string; kind: "user" | "team" };
  pipe: { id: string; name: string; archived: boolean } | null;
  /** Board column; none in an incoming bucket. */
  column: string | null;
  owner: UserRef | null;
  priority: Priority | null;
  labels: Label[];
  /** Its content stays on its page: no excerpt. */
  confidential: boolean;
  /** What matched besides the title, matched words between \u0002 and \u0003. */
  snippet: string | null;
}

/** An account, as the administration page lists it (GET /api/admin/users). */
export interface AdminUser {
  id: string;
  name: string;
  email: string | null;
  kind: "outline" | "email" | "oidc";
  outlineUrl: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  disabled: { at: string; reason: "admin" | "unused_invitation"; by: string | null } | null;
  admin: boolean;
}

/** What an import of tasks would do (POST /api/pipes/:id/import/preview). */
export interface ImportPreview {
  headers: string[];
  /** Target of each column of the file ("title", "field:financement", "ignore"…). */
  mapping: string[];
  targets: { id: string; label: string }[];
  taskTypes: { id: string; label: string }[];
  columns: { id: string; label: string }[];
  /** Values of the file's column cells matching no column of the pipe, and where each goes ("" until chosen). */
  columnValues: { value: string; column: string }[];
  count: number;
  tasks: { line: number; title: string; stage: string; owner: string | null; dueDate: string | null }[];
  errors: { line: number; message: string }[];
  errorCount: number;
}

/** A personal access token of the public API (its value is only shown at creation). */
export interface AccessToken {
  id: string;
  name: string;
  prefix: string;
  scope: "read" | "write";
  expiresAt: string;
  lastUsedAt: string | null;
  createdAt: string;
  expired: boolean;
}

/** An outgoing webhook of a pipe, with its latest deliveries. */
export interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  /** Signed JSON, or a message for a chat channel. */
  format: "json" | "slack" | "mattermost" | "teams";
  locale: string;
  secret: string;
  createdAt: string;
  deliveries: {
    id: string;
    event: string;
    attempts: number;
    createdAt: string;
    state: "delivered" | "failed" | "pending";
    status: number | null;
    error: string | null;
  }[];
}

/** The repetition of a task (a recurring series), see recurrence.ts. */
export interface Recurrence {
  id: string;
  rule: {
    freq: "daily" | "weekly" | "monthly" | "yearly";
    interval: number;
    weekdays?: number[];
    monthly?: { kind: "day"; day: number } | { kind: "weekday"; nth: 1 | 2 | 3 | 4 | -1; weekday: number } | { kind: "lastBusinessDay" };
  };
  mode: "schedule" | "after_done";
  leadDays: number;
  startsOn: string;
  endsOn: string | null;
  nextOn: string | null;
  active: boolean;
  /** The next dates, the first being nextOn. */
  upcoming: string[];
}
