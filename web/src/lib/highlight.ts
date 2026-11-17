/**
 * Showing a task on its page, reached from a notification: the page scrolls to it and it shines in yellow a
 * moment (.task-highlight in app.css). Pages that hide tasks (filters, another view) make it visible while
 * app.highlight names it. If it cannot be found in time (hidden by the page, or gone), its dialog opens instead.
 */
import { tick } from "svelte";
import { app } from "./app.svelte";

export const HIGHLIGHT_MS = 4000;
const FIND_MS = 5000;

const selector = (id: string) => `[data-task-card="${CSS.escape(id)}"], [data-task-id="${CSS.escape(id)}"]`;

/** Call it right after navigating: the page left behind may show the same task, so the search waits for the new one. */
export function highlightTask(id: string) {
  app.highlight = id;
  const start = Date.now();
  const find = () => {
    if (app.highlight !== id) return;
    const el = document.querySelector<HTMLElement>(selector(id));
    if (el && el.getClientRects().length) {
      el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      el.classList.remove("task-highlight");
      void el.offsetWidth; // restarts the animation
      el.classList.add("task-highlight");
      setTimeout(() => {
        el.classList.remove("task-highlight");
        if (app.highlight === id) app.highlight = null;
      }, HIGHLIGHT_MS);
      return;
    }
    if (Date.now() - start > FIND_MS) {
      app.highlight = null;
      app.openTask(id);
      return;
    }
    setTimeout(find, 100);
  };
  tick().then(() => setTimeout(find, 50));
}
