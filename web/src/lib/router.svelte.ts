class Router {
  path = $state(location.pathname);
  search = $state(location.search);
  params = $derived(new URLSearchParams(this.search));

  sync = () => {
    this.path = location.pathname;
    this.search = location.search;
  };
}

export const router = new Router();
window.addEventListener("popstate", router.sync);

export function navigate(to: string, { replace = false } = {}) {
  history[replace ? "replaceState" : "pushState"]({}, "", to);
  router.sync();
}

/** Sets or removes query parameters on the current URL. */
export function setParams(changes: Record<string, string | null>, opts?: { replace?: boolean }) {
  const params = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) params.delete(k);
    else params.set(k, v);
  }
  const qs = params.toString();
  navigate(`${location.pathname}${qs ? `?${qs}` : ""}`, opts);
}

/** Intercepts clicks on internal links so navigation stays client-side. */
export function interceptLinks(e: MouseEvent) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as HTMLElement).closest("a");
  if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
  const href = a.getAttribute("href");
  if (!href || !href.startsWith("/") || href.startsWith("/auth/")) return;
  e.preventDefault();
  navigate(href);
}
