/** A task dragged from a pipe's board, as dropped on a pipe of the sidebar (Sidebar.svelte): its own data type. */
export const TASK_DRAG = "application/x-taskspipes-task";

export interface DraggedTask {
  id: string;
  title: string;
  pipeId: string;
  spaceId: string;
}

/** The task a drop carries, or null (anything else dragged: a file, text…). */
export function draggedTask(e: DragEvent): DraggedTask | null {
  try {
    const t = JSON.parse(e.dataTransfer?.getData(TASK_DRAG) || "null");
    return t && typeof t.id === "string" && typeof t.pipeId === "string" && typeof t.spaceId === "string" ? t : null;
  } catch {
    return null;
  }
}

/** Whether what is dragged over is a task (its data is only readable on drop, its type on drag over). */
export const isTaskDrag = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes(TASK_DRAG);

/** A pipe dragged from the sidebar onto a team, to move it there with its tasks (Sidebar.svelte). */
export const PIPE_DRAG = "application/x-taskspipes-pipe";

export interface DraggedPipe {
  id: string;
  name: string;
  spaceId: string;
}

/** The pipe a drop carries, or null. */
export function draggedPipe(e: DragEvent): DraggedPipe | null {
  try {
    const p = JSON.parse(e.dataTransfer?.getData(PIPE_DRAG) || "null");
    return p && typeof p.id === "string" && typeof p.name === "string" && typeof p.spaceId === "string" ? p : null;
  } catch {
    return null;
  }
}

export const isPipeDrag = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes(PIPE_DRAG);
