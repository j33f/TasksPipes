import { prefs, t } from "./i18n.svelte";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    // The server answers (errors, catalog…) in the language of the page.
    headers: body !== undefined ? { "Content-Type": "application/json", "X-Locale": prefs.lang } : { "X-Locale": prefs.lang },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/api/auth")) window.dispatchEvent(new Event("tp:unauthorized"));
    throw new ApiError(res.status, json.error || t("Error {n}", { n: res.status }));
  }
  return json as T;
}

/** Sends one file as the raw request body. */
async function upload<T>(path: string, file: Blob & { name?: string; type: string }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Locale": prefs.lang,
      "X-File-Name": encodeURIComponent(file.name ?? "file"),
      "X-File-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.error || (res.status === 413 ? t("File too large") : t("Error {n}", { n: res.status })));
  return json as T;
}

export const MAX_FILE_SIZE = 50 * 1024 * 1024;

export const api = {
  upload,
  get: <T = unknown>(p: string) => request<T>("GET", `/api${p}`),
  post: <T = unknown>(p: string, b: unknown = {}) => request<T>("POST", `/api${p}`, b),
  patch: <T = unknown>(p: string, b: unknown = {}) => request<T>("PATCH", `/api${p}`, b),
  put: <T = unknown>(p: string, b: unknown = {}) => request<T>("PUT", `/api${p}`, b),
  del: <T = unknown>(p: string) => request<T>("DELETE", `/api${p}`),
};

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
