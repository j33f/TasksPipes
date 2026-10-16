export type Status = "backlog" | "ready" | "started" | "ongoing" | "blocked" | "abandoned" | "done";

export interface UserRef {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

export interface User extends UserRef {
  spaceId: string;
  active: boolean;
}

export interface Me {
  user: UserRef & { email: string | null };
  personalSpaceId: string;
  outlineUrl: string;
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
  position: number;
  dueDate: string | null;
  space: { id: string; name: string; kind: "user" | "team" };
  pipe: { id: string; name: string; visibility: "private" | "open" } | null;
  inIncoming: boolean;
  author: UserRef;
  assignee: UserRef | null;
  sender: UserRef | null;
  outlineDoc: DocRef | null;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface EventSide {
  location: { spaceId: string; spaceName: string; pipeId: string | null; pipeName: string | null; incoming: boolean } | null;
  status: Status | null;
  assignee: UserRef | null;
  dueDate: string | null;
  doc: DocRef | null;
}

export interface TaskEvent {
  id: number;
  type: "created" | "sent" | "accepted" | "moved" | "status" | "refused" | "updated" | "edited" | "comment";
  comment: string | null;
  createdAt: string;
  actor: UserRef;
  from: EventSide;
  to: EventSide;
}

export interface TaskDetail extends Task {
  permissions: { view: boolean; manage: boolean; editContent: boolean; comment: boolean; refuse: boolean };
  events: TaskEvent[];
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
}

export interface PipeType {
  id: string;
  label: string;
  group: string;
  description: string;
  color: string;
  icon: string;
  templates: string[];
}

export interface OutlineDoc extends DocRef {
  updatedAt?: string;
}
