/**
 * Who may see and do what: the shared rules of the API and of everything acting on someone's behalf
 * (e-mail notifications…). Visibility of people and spaces is decided in SQL (user_visible, space_visible).
 */
import { one, type Queryable, type Row } from "./db.js";
import { pipeTypeById } from "./pipeTypes.js";

export const SPACE_NAME = `COALESCE(su.name, s.name)`;

export async function memberRole(spaceId: string, userId: string, db?: Queryable): Promise<string | null> {
  const r = await one(`SELECT role FROM space_members WHERE space_id = $1 AND user_id = $2`, [spaceId, userId], db);
  return r?.role ?? null;
}

export const TASK_SELECT = `
  SELECT t.*, p.name AS pipe_name, p.visibility AS pipe_visibility, p.kind AS pipe_kind,
         ${SPACE_NAME} AS space_name, s.kind AS space_kind, s.user_id AS space_user_id, su.avatar_url AS space_user_avatar,
         au.name AS author_name, au.avatar_url AS author_avatar,
         asg.name AS assignee_name, asg.avatar_url AS assignee_avatar,
         se.name AS sender_name, se.avatar_url AS sender_avatar,
         (SELECT count(*) FROM task_events e WHERE e.task_id = t.id AND e.type = 'comment') AS comment_count,
         (SELECT l.state FROM task_links l WHERE l.task_id = t.id AND l.kind <> 'commit' ORDER BY l.updated_at DESC LIMIT 1) AS git_state,
         (SELECT json_build_object('total', count(*), 'done', count(*) FILTER (WHERE i.done),
                   'next', (array_agg(json_build_object('id', i.id, 'text', i.text) ORDER BY i.position, i.created_at)
                            FILTER (WHERE NOT i.done))[1])
          FROM task_items i WHERE i.task_id = t.id) AS checklist
  FROM tasks t
  JOIN spaces s ON s.id = t.space_id
  LEFT JOIN users su ON su.id = s.user_id
  LEFT JOIN pipes p ON p.id = t.pipe_id
  JOIN users au ON au.id = t.author_id
  LEFT JOIN users asg ON asg.id = t.assignee_id
  LEFT JOIN users se ON se.id = t.sender_id`;

export const getTaskRow = (id: string, db?: Queryable) => one(`${TASK_SELECT} WHERE t.id = $1`, [id], db);

export interface TaskPermissions {
  view: boolean;
  manage: boolean;
  editContent: boolean;
  comment: boolean;
  refuse: boolean;
}

export async function taskPermissions(t: Row, userId: string): Promise<TaskPermissions> {
  const isMember = Boolean(await memberRole(t.space_id, userId));
  // An open pipe is open to those who can reach its space (not to people unknown to its owner).
  const openPipe = t.pipe_visibility === "open" && (isMember || (await spaceVisible(t.space_id, userId)));
  // In a pipe reserved to a team (PSH…), only the team's members see the task, not even its author or sender.
  const involved = (t.author_id === userId || t.sender_id === userId) && !pipeTypeById(t.pipe_kind)?.teamOnly;
  return {
    view: isMember || openPipe || involved,
    manage: isMember,
    editContent: isMember || (t.author_id === userId && openPipe),
    comment: isMember || openPipe || involved,
    // A task can be refused only from an incoming bucket, and only if someone else sent it.
    refuse: isMember && !t.pipe_id && Boolean(t.sender_id) && t.sender_id !== userId,
  };
}

/** Whether someone may reach a space (see space_visible in the schema). */
export const spaceVisible = async (spaceId: string, userId: string, db?: Queryable) =>
  Boolean((await one(`SELECT space_visible($2, $1) AS ok`, [spaceId, userId], db))?.ok);
