/** The installable app's service worker, and push notifications on this device. */
import { api } from "./api";

/** Registers the service worker (production only: in development, Vite serves the page). */
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || import.meta.env.DEV) return;
  navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(__APP_VERSION__)}`).catch(() => {});
}

export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** This device's subscription, if push is on here. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

const key = (b64: string) => {
  const raw = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Turns push on for this device: asks permission, subscribes with the server's key, and tells the server. */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported() || (await Notification.requestPermission()) !== "granted") return false;
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api.get<{ publicKey: string }>("/push/key");
  let sub = await reg.pushManager.getSubscription();
  // Subscribed with another key (APP_SECRET changed): subscribe again.
  if (sub && sub.options.applicationServerKey && btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") !== publicKey) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(publicKey) });
  await api.post("/me/push", sub.toJSON());
  return true;
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.del("/me/push", { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}
