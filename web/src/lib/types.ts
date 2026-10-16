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
    kind: "outline" | "email";
    totp: boolean;
    /** Chosen language and theme; null follows the browser / the system. */
    locale: "en" | "fr" | null;
    theme: "light" | "dark" | null;
  };
  personalSpaceId: string;
  outlineUrl: string;
  /** What this instance allows. */
  features: { invitations: boolean };
}

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
}

export interface Member extends UserRef {
  role: "admin" | "member";
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
  /** Sub-tasks: how many, how many checked, and the first one left. */
  checklist: { total: number; done: number; next: { id: string; text: string } | null };
  createdAt: string;
  updatedAt: string;
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
  type: "created" | "sent" | "accepted" | "moved" | "status" | "refused" | "updated" | "edited" | "comment" | "fields" | "file" | "checklist";
  comment: string | null;
  details: {
    fields?: string[];
    taskType?: { from: string; to: string };
    added?: string;
    removed?: string;
    field?: string;
    item?: string;
    done?: boolean;
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
  invitedByMe: boolean;
  avatarUrl: string | null;
  /** A person already on the platform answers the request; a new address is accepted at once. */
  status: "pending" | "accepted" | "refused";
  createdAt: string;
}
