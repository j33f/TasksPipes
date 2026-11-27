// Ctrl/⌘ + Enter saves what is being edited: it presses the save button nearest to the focused field,
// as if it had been clicked. A field inside a form submits that form; elsewhere, the button marked
// `data-save` in the closest enclosing block is pressed. A disabled button is left alone.

export const isSaveShortcut = (e: KeyboardEvent) =>
  (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === "Enter" && !e.isComposing;

const enabled = (b: Element | null): b is HTMLButtonElement => b instanceof HTMLButtonElement && !b.disabled;

/** What Ctrl/⌘ + Enter should press for a key pressed on `from`, if anything. */
export function saveButtonFor(from: Element | null): HTMLButtonElement | HTMLFormElement | null {
  for (let el = from; el && el !== document.body; el = el.parentElement) {
    if (el instanceof HTMLFormElement) {
      const marked = el.querySelector("button[data-save]");
      if (marked) return enabled(marked) ? marked : null;
      const submit = Array.from(el.querySelectorAll("button")).find((b) => b.type === "submit" && b.form === el);
      if (submit) return enabled(submit) ? submit : null;
      return el;
    }
    const marked = el.querySelector("button[data-save]");
    if (marked) return enabled(marked) ? marked : null;
  }
  return null;
}

export function onSaveShortcut(e: KeyboardEvent) {
  if (!isSaveShortcut(e) || e.defaultPrevented) return;
  const what = saveButtonFor(e.target instanceof Element ? e.target : null);
  if (!what) return;
  e.preventDefault();
  if (what instanceof HTMLFormElement) what.requestSubmit();
  else if (what.form && what.type === "submit") what.form.requestSubmit(what);
  else what.click();
}
