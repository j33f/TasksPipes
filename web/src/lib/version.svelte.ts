/**
 * Keeps an open page in step with the server: after an update, the server announces another version
 * (X-App-Version header, WebSocket greeting) and the page reloads itself — at once if nothing is being
 * edited, otherwise a banner offers to, and it happens on the next exchange once the edit is over.
 */
const KEY = "tp:reloadedFor";

export const update = new (class {
  /** The server runs another version and the page could not reload by itself yet. */
  available = $state(false);
})();

/** Nothing would be lost: no dialog open, no field being edited. */
function safeToReload(): boolean {
  const el = document.activeElement;
  const editing = el instanceof HTMLElement && (el.isContentEditable || el.matches("input, textarea, select"));
  return !editing && !document.querySelector(".modal-backdrop");
}

export function reloadNow() {
  location.reload();
}

export function checkServerVersion(serverVersion: string | null | undefined) {
  if (!serverVersion || serverVersion === __APP_VERSION__) return;
  let last: string | null = null;
  try {
    last = sessionStorage.getItem(KEY);
  } catch {
    /* storage unavailable */
  }
  // Already reloaded once for this version and still different (a cached page…): no loop, just the banner.
  if (last !== serverVersion && safeToReload()) {
    try {
      sessionStorage.setItem(KEY, serverVersion);
    } catch {
      /* storage unavailable */
    }
    location.reload();
    return;
  }
  update.available = true;
}
