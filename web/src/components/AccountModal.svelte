<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { formatDate } from "../lib/constants";
  import type { Invitation } from "../lib/types";
  import Modal from "./Modal.svelte";
  import Avatar from "./Avatar.svelte";
  import Icon from "./Icon.svelte";
  import InviteModal from "./InviteModal.svelte";
  import { LOCALES, prefs, t, type Locale, type Theme } from "../lib/i18n.svelte";

  let { onclose }: { onclose: () => void } = $props();

  const user = $derived(app.me!.user);
  let name = $state(app.me?.user.name ?? "");
  let invitations = $state<Invitation[]>([]);
  let inviting = $state(false);
  let setup = $state<{ secret: string; url: string; qr: string } | null>(null);
  let disabling = $state(false);
  let code = $state("");
  let busy = $state(false);
  let error = $state("");

  // Calendar subscription link (made on first display).
  let calendar = $state<string | null>(null);
  api.get<{ url: string }>("/me/calendar").then((r) => (calendar = r.url)).catch(() => {});
  const webcal = $derived(calendar?.replace(/^https?:/, "webcal:") ?? "");
  const googleUrl = $derived(`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`);

  async function copyCalendar() {
    try {
      await navigator.clipboard.writeText(calendar!);
      app.toast(t("Link copied"));
    } catch {
      app.toast(t("Could not copy: select the link"), "error");
    }
  }

  async function resetCalendar() {
    if (!confirm(t("Make a new link? Calendars subscribed with the current one will stop showing your tasks."))) return;
    try {
      calendar = (await api.post<{ url: string }>("/me/calendar/reset")).url;
      app.toast(t("New calendar link made"));
    } catch (err) {
      error = errorMessage(err);
    }
  }

  const loadInvitations = () => api.get<Invitation[]>("/invitations").then((r) => (invitations = r)).catch(() => {});
  loadInvitations();

  async function run(fn: () => Promise<unknown>, success?: string) {
    busy = true;
    error = "";
    try {
      await fn();
      if (success) app.toast(success);
      await app.init();
      app.refresh();
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  // Picture of an e-mail account: cropped to a square and shrunk in the browser before upload.
  let picking = $state<HTMLInputElement>();
  async function setAvatar(file: File | undefined) {
    if (!file) return;
    try {
      const img = await createImageBitmap(file);
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 256;
      canvas.getContext("2d")!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
      const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.88));
      if (!blob) throw new Error(t("This picture cannot be read"));
      await run(() => api.upload("/me/avatar", blob), t("Picture updated"));
    } catch (err) {
      error = errorMessage(err);
    }
  }

  function saveName() {
    if (name.trim() && name !== user.name) run(() => api.patch("/me", { name }), t("Name saved"));
  }

  // Applied at once in this browser, then kept in the profile.
  function setPref(next: { locale?: Locale | null; theme?: Theme | null }) {
    prefs.set(next);
    api.patch("/me", next).then(() => app.init()).catch((err) => (error = errorMessage(err)));
  }

  async function startSetup() {
    busy = true;
    error = "";
    try {
      setup = await api.post("/me/totp/setup");
      code = "";
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  async function enable(e: SubmitEvent) {
    e.preventDefault();
    await run(() => api.post("/me/totp/enable", { code }), t("Two-factor authentication turned on"));
    if (!error) setup = null;
    code = "";
  }

  async function disable(e: SubmitEvent) {
    e.preventDefault();
    await run(() => api.post("/me/totp/disable", { code }), t("Two-factor authentication turned off"));
    if (!error) disabling = false;
    code = "";
  }

  async function answer(i: Invitation, accept: boolean) {
    await run(() => api.post(`/invitations/${i.id}/${accept ? "accept" : "refuse"}`), accept ? t("You are now connected with {name}", { name: i.name }) : t("Request refused"));
    loadInvitations();
  }

  const resend = (i: Invitation) =>
    api
      .post<{ sent: boolean; link?: string }>(`/invitations/${i.id}/resend`)
      .then(async (r) => {
        if (r.sent) app.toast(t("New link sent to {email}", { email: i.email ?? "" }));
        else if (r.link) {
          await navigator.clipboard.writeText(r.link).catch(() => {});
          app.toast(t("E-mail is not set up: new link copied, pass it on yourself"));
        }
      })
      .catch((err) => app.toast(errorMessage(err), "error"));
</script>

<Modal title={t("My account")} {onclose}>
  <div class="profile">
    {#if app.isGuest}
      <button class="avatar-btn" title={t("Change the picture")} onclick={() => picking?.click()}>
        <Avatar {user} size={48} />
        <span class="avatar-edit"><Icon name="edit" size={14} /></span>
      </button>
      <input bind:this={picking} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden
        onchange={(e) => { setAvatar((e.currentTarget as HTMLInputElement).files?.[0]); (e.currentTarget as HTMLInputElement).value = ""; }} />
    {:else}
      <Avatar {user} size={48} />
    {/if}
    <div class="grow">
      {#if app.isGuest}
        <input class="input" bind:value={name} maxlength="120" onblur={saveName} aria-label={t("Name")}
          onkeydown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />
      {:else}
        <strong>{user.name}</strong>
      {/if}
      <div class="small muted">{user.email ?? ""} · {app.isGuest ? t("e-mail account") : t("Outline account")}</div>
      {#if app.isGuest && user.avatarUrl}
        <button class="btn ghost small remove-pic" onclick={() => run(() => api.del("/me/avatar"), t("Picture removed"))}>{t("Remove the picture")}</button>
      {/if}
    </div>
  </div>

  {#if error}<div class="error-text">{error}</div>{/if}

  <div class="section">
    <div class="section-title"><Icon name="settings" />{t("Display")}</div>
    <div class="prefs">
      <label class="pref">
        <span class="label-text">{t("Language")}</span>
        <select class="input" value={prefs.locale ?? ""}
          onchange={(e) => setPref({ locale: ((e.currentTarget as HTMLSelectElement).value || null) as Locale | null })}>
          <option value="">{t("Language of the browser")}</option>
          {#each LOCALES as l (l.id)}<option value={l.id}>{l.label}</option>{/each}
        </select>
      </label>
      <div class="pref">
        <span class="label-text">{t("Theme")}</span>
        <div class="seg" role="group" aria-label={t("Theme")}>
          {#each [[null, "Automatic"], ["light", "Light"], ["dark", "Dark"]] as const as [value, label] (label)}
            <button type="button" class:active={prefs.theme === value} onclick={() => setPref({ theme: value })}>{t(label)}</button>
          {/each}
        </div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title"><Icon name="calendar" />{t("Calendar")}</div>
    <p class="small">{t("Subscribe to your tasks with a due date in Google Calendar, Apple Calendar or any calendar app. The link is personal: keep it to yourself.")}</p>
    {#if calendar}
      <div class="row">
        <input class="input cal-url" readonly value={calendar} aria-label={t("Calendar link")}
          onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
        <button class="btn neutral small" onclick={copyCalendar}>{t("Copy")}</button>
      </div>
      <div class="row wrap cal-actions">
        <a class="btn small" href={googleUrl} target="_blank" rel="noreferrer">{t("Add to Google Calendar")}</a>
        <a class="btn small neutral" href={webcal}>{t("Add to Apple Calendar")}</a>
        <span class="spacer"></span>
        <button class="btn ghost small" onclick={resetCalendar}>{t("New link…")}</button>
      </div>
      <p class="hint">{t("Calendars refresh at their own pace: within the hour for Apple, up to a day for Google.")}</p>
    {/if}
  </div>

  {#if app.isGuest}
    <div class="section">
      <div class="section-title"><Icon name="shield" />{t("Two-factor authentication")}</div>
      {#if user.totp}
        <p class="small">
          <span class="ok"><Icon name="check" size={14} />{t("On.")}</span>
          {t("At each sign-in, after the link received by e-mail, the code from your app is asked for.")}
        </p>
        {#if disabling}
          <form class="row" onsubmit={disable}>
            <input class="input code" inputmode="numeric" maxlength="7" placeholder={t("Current code")} bind:value={code} aria-label={t("Code")} />
            <button class="btn danger small" disabled={busy}>{t("Turn off")}</button>
            <button type="button" class="btn ghost small" onclick={() => (disabling = false)}>{t("Cancel")}</button>
          </form>
        {:else}
          <button class="btn neutral small" onclick={() => (disabling = true)}>{t("Turn off…")}</button>
        {/if}
      {:else if setup}
        <ol class="small steps">
          <li>{t("Open Google Authenticator (or a similar app) and scan this code:")}</li>
        </ol>
        <div class="qr-row">
          <img src={setup.qr} alt={t("QR code to scan")} width="180" height="180" />
          <div class="small muted">
            {t("Or type this key:")}
            <code class="secret">{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>
          </div>
        </div>
        <ol class="small steps" start="2"><li>{t("Enter the 6-digit code shown:")}</li></ol>
        <form class="row" onsubmit={enable}>
          <!-- svelte-ignore a11y_autofocus -->
          <input class="input code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123 456"
            bind:value={code} autofocus aria-label={t("Code")} />
          <button class="btn small" disabled={busy || code.replace(/\s/g, "").length !== 6}>{t("Turn on")}</button>
          <button type="button" class="btn ghost small" onclick={() => (setup = null)}>{t("Cancel")}</button>
        </form>
      {:else}
        <p class="small">{t("Protect your account: besides the link received by e-mail, a code from your phone will be asked at each sign-in.")}</p>
        <button class="btn small" disabled={busy} onclick={startSetup}>{t("Turn on with Google Authenticator…")}</button>
      {/if}
    </div>
  {/if}

  <div class="section">
    <div class="section-title">
      <Icon name="mail" />{t("Invitations")}
      <span class="spacer"></span>
      {#if app.me?.features.invitations}
        <button class="btn small neutral" onclick={() => (inviting = true)}><Icon name="plus" size={16} />{t("Invite by e-mail")}</button>
      {/if}
    </div>
    {#each invitations as i (i.id)}
      <div class="inv row">
        <Avatar user={i} size={28} />
        <div class="grow">
          <strong>{i.name}</strong>
          <div class="small muted">
            {#if i.invitedByMe && i.status === "pending"}
              {t("asked on {date}, waiting for an answer", { date: formatDate(i.createdAt) })}
            {:else if i.invitedByMe && i.status === "refused"}
              {t("asked on {date}", { date: formatDate(i.createdAt) })}
            {:else if i.invitedByMe}
              {i.email} · {t("invited on {date}", { date: formatDate(i.createdAt) })} · {i.active ? t("has signed in") : t("not signed in yet")}
            {:else if i.status === "pending"}
              {t("wants to connect with you, to share tasks")}
            {:else}
              {t("invited you on {date}", { date: formatDate(i.createdAt) })}
            {/if}
          </div>
        </div>
        {#if !i.invitedByMe && i.status === "pending"}
          <button class="btn small" onclick={() => answer(i, true)}>{t("Accept")}</button>
          <button class="btn ghost small" onclick={() => answer(i, false)}>{t("Refuse")}</button>
        {:else if i.invitedByMe && i.status === "accepted"}
          <button class="btn ghost small" onclick={() => resend(i)}>{t("Send a new link")}</button>
        {/if}
      </div>
    {:else}
      <div class="small muted">
        {t("Invite people by e-mail (trainers, clients, partners…): new people get a sign-in link, people already on TasksPipes get a request to connect. Once connected, you see each other.")}
      </div>
    {/each}
  </div>
</Modal>

{#if inviting}<InviteModal onclose={() => (inviting = false)} ondone={loadInvitations} />{/if}

<style>
  .profile { display: flex; align-items: center; gap: 12px; }
  .avatar-btn { position: relative; border: 0; background: none; padding: 0; cursor: pointer; border-radius: 50%; display: flex; }
  .avatar-edit {
    position: absolute; right: -2px; bottom: -2px; width: 22px; height: 22px; border-radius: 50%; display: flex;
    align-items: center; justify-content: center; background: var(--background); box-shadow: var(--card-shadow); color: var(--text-secondary);
  }
  .remove-pic { margin-left: -8px; }
  .grow { flex: 1; min-width: 0; }
  .section { margin-top: 24px; }
  .ok { color: #2a9d63; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; }
  .steps { padding-left: 18px; margin: 4px 0 8px; }
  .qr-row { display: flex; gap: 16px; align-items: center; margin-bottom: 12px; }
  .qr-row img { border-radius: 6px; background: #fff; }
  .secret { display: block; margin-top: 6px; font-size: 14px; word-break: break-all; color: var(--text); }
  .code { max-width: 140px; font-variant-numeric: tabular-nums; letter-spacing: 0.1em; }
  .cal-url { font-size: 13px; min-height: 30px; padding: 4px 8px; }
  .cal-actions { margin-top: 8px; }
  .prefs { display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-end; }
  .pref .input { min-height: 32px; padding: 4px 8px; font-size: 14px; width: auto; }
  .seg { display: inline-flex; border: 1px solid var(--input-border); border-radius: 6px; overflow: hidden; }
  .seg button { border: 0; background: none; color: var(--text-secondary); font: inherit; font-size: 13px; padding: 6px 12px; cursor: pointer; }
  .seg button.active { background: var(--background-secondary); color: var(--text); font-weight: 500; }
  .inv { padding: 8px 0; border-top: 1px solid var(--divider); }
</style>
