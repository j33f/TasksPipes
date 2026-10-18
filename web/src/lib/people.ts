import { api, errorMessage } from "./api";
import { app } from "./app.svelte";
import { t } from "./i18n.svelte";

/**
 * An Outline colleague imported from the workspace who never signed in: until they do, they get no task and join
 * no team, and are invited instead. People invited by e-mail are not concerned.
 */
export const awaitingSignIn = (p: { active: boolean; guest: boolean }) => !p.active && !p.guest;

/** Invites such a colleague: by e-mail, or, when the instance has none, by copying the link to give them. */
export async function inviteColleague(userId: string, name: string) {
  try {
    const r = await api.post<{ sent: boolean; link?: string }>(`/users/${userId}/invite`);
    if (r.sent) return app.toast(t("Invitation sent to {name}", { name }));
    try {
      await navigator.clipboard.writeText(r.link!);
      app.toast(t("Link copied: give it to {name}, who signs in with Outline", { name }));
    } catch {
      app.toast(t("Give {name} this link, to sign in with Outline: {link}", { name, link: r.link! }));
    }
  } catch (err) {
    app.toast(errorMessage(err), "error");
  }
}
