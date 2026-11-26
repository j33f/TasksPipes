/**
 * Cards gliding to their new place when a board changes under one's eyes (a task moved by someone else, by an agent):
 * where each card was is noted before the change, and once the page shows it, each card that moved slides from
 * there (FLIP: first, last, invert, play), across columns too; a card that appeared fades in. Nothing moves for those
 * who asked their system for less motion.
 */
export type Places = Map<string, DOMRect>;

const SELECTOR = "[data-task-card]";

/** Where each card of the page is now. */
export function notePlaces(root: ParentNode = document): Places {
  const places: Places = new Map();
  for (const el of root.querySelectorAll<HTMLElement>(SELECTOR)) places.set(el.dataset.taskCard!, el.getBoundingClientRect());
  return places;
}

/** Plays the moves since `before` (nothing the first time, when no card was there yet). */
export function playMoves(before: Places, root: ParentNode = document) {
  if (!before.size || typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  for (const el of root.querySelectorAll<HTMLElement>(SELECTOR)) {
    if (typeof el.animate !== "function") return;
    const old = before.get(el.dataset.taskCard!);
    if (!old) {
      el.animate([{ opacity: 0, transform: "scale(0.96)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "ease-out" });
      continue;
    }
    const now = el.getBoundingClientRect();
    const dx = old.left - now.left;
    const dy = old.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    // Above the others while it travels, a little lifted.
    el.style.position = "relative";
    el.style.zIndex = "5";
    const far = Math.abs(dx) > 40;
    const run = el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)`, boxShadow: far ? "0 8px 24px rgb(0 0 0 / 18%)" : "" },
        { transform: "none", boxShadow: "" },
      ],
      { duration: far ? 520 : 300, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
    );
    run.onfinish = run.oncancel = () => {
      el.style.position = "";
      el.style.zIndex = "";
    };
  }
}
