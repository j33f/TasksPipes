/**
 * A one-line title one can edit, shown whole: a textarea that grows with its text (a long title wraps instead of being
 * cut, as an input did) and stays one paragraph (no line breaks, Enter validates). Used for the titles of tasks and
 * pipes (TaskModal, PipePage).
 */
export function autosize(el: HTMLTextAreaElement, _value?: string) {
  const fit = () => {
    // Line breaks pasted in: a title is one line.
    if (/[\r\n]/.test(el.value)) el.value = el.value.replace(/[\r\n]+/g, " ");
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  // Its width changes (a narrower window): so does the number of lines. Absent in tests (jsdom).
  const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
  resize?.observe(el);
  el.addEventListener("input", fit);
  fit();
  return {
    // The value changed from elsewhere (bind:value, another person's edit): fitted again.
    update: () => queueMicrotask(fit),
    destroy() {
      resize?.disconnect();
      el.removeEventListener("input", fit);
    },
  };
}
