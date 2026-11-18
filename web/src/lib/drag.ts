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
