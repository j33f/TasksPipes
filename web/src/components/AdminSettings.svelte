<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { t } from "../lib/i18n.svelte";
  import { LABELS, SECTIONS, type Setting } from "../lib/admin-settings";


  let settings = $state<Setting[]>([]);
  let redirects = $state<{ oauthRedirect: string; oidcRedirect: string } | null>(null);
  /** Values being edited, by key (lists as text, one per line). */
  let draft = $state<Record<string, unknown>>({});
  let busy = $state<string | null>(null);
  let error = $state("");

  const toDraft = (list: Setting[]) =>
    Object.fromEntries(list.map((s) => [s.key, s.kind === "secret" ? "" : s.kind === "list" ? ((s.value as string[]) ?? []).join("\n") : s.value]));

  async function load() {
    try {
      const r = await api.get<{ settings: Setting[]; oauthRedirect: string; oidcRedirect: string }>("/admin/settings");
      settings = r.settings;
      redirects = r;
      draft = toDraft(r.settings);
    } catch (err) {
      error = errorMessage(err);
    }
  }
  load();

  /** What changed in a section (locked settings left out; an empty secret keeps the current one). */
  function changes(section: Setting["section"]) {
    const out: Record<string, unknown> = {};
    for (const s of settings.filter((x) => x.section === section && !x.locked)) {
      const v = draft[s.key];
      if (s.kind === "secret") {
        if (v) out[s.key] = v;
      } else if (s.kind === "list") {
        const list = String(v ?? "").split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
        if (JSON.stringify(list) !== JSON.stringify(s.value ?? [])) out[s.key] = list;
      } else if (s.kind === "int") {
        if (Number(v) !== s.value) out[s.key] = Number(v);
      } else if (v !== s.value) {
        out[s.key] = v;
      }
    }
    return out;
  }

  async function save(section: Setting["section"]) {
    const body = changes(section);
    if (!Object.keys(body).length) return app.toast(t("Nothing changed"));
    busy = section;
    error = "";
    try {
      const r = await api.put<{ settings: Setting[] }>("/admin/settings", { settings: body });
      settings = r.settings;
      // This section shows what was saved; the others keep what is being typed.
      const saved = toDraft(r.settings.filter((s) => s.section === section));
      draft = { ...draft, ...saved };
      app.toast(t("Settings saved"));
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = null;
    }
  }

  async function clearSecret(s: Setting) {
    if (!confirm(t("Remove the stored value of “{name}”?", { name: t(LABELS[s.key]?.[0] ?? s.key) }))) return;
    busy = s.section;
    try {
      const r = await api.put<{ settings: Setting[] }>("/admin/settings", { settings: { [s.key]: null } });
      settings = r.settings;
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = null;
    }
  }

  async function testMail() {
    busy = "test";
    try {
      const r = await api.post<{ to: string }>("/admin/settings/test-mail");
      app.toast(t("Test e-mail sent to {email}", { email: r.to }));
    } catch (err) {
      app.toast(errorMessage(err), "error");
    } finally {
      busy = null;
    }
  }
</script>

{#if error}<p class="error-text" role="alert">{error}</p>{/if}
<p class="muted small">{t("Changes apply at once. A setting given by the server's environment (.env) is shown locked: change it there.")}</p>

{#each SECTIONS as section (section.id)}
  {@const list = settings.filter((s) => s.section === section.id)}
  {#if list.length}
    <section class="section" data-section={section.id}>
      <h2>{t(section.title)}</h2>
      <p class="small muted">{t(section.intro)}</p>
      {#if section.id === "outlineOauth" && redirects}<code class="redirect">{redirects.oauthRedirect}</code>{/if}
      {#if section.id === "oidc" && redirects}<code class="redirect">{redirects.oidcRedirect}</code>{/if}
      {#each list as s (s.key)}
        {@const [label, hint] = LABELS[s.key] ?? [s.key]}
        <div class="field">
          {#if s.kind === "bool"}
            <label class="check">
              <input type="checkbox" checked={draft[s.key] === true || (draft[s.key] === null && s.key === "smtp.secure" && Number(draft["smtp.port"]) === 465)}
                disabled={s.locked} onchange={(e) => (draft[s.key] = (e.currentTarget as HTMLInputElement).checked)} />
              {t(label)}
            </label>
          {:else}
            <label for={`set-${s.key}`}>{t(label)}</label>
            {#if s.kind === "list"}
              <textarea id={`set-${s.key}`} class="input" rows="3" disabled={s.locked} bind:value={draft[s.key]}></textarea>
            {:else if s.kind === "secret"}
              <div class="row">
                <input id={`set-${s.key}`} class="input" type="password" autocomplete="new-password" disabled={s.locked}
                  placeholder={s.isSet ? t("Set: type a new value to replace it") : t("Not set")} bind:value={draft[s.key]} />
                {#if s.isSet && !s.locked}<button class="btn ghost small" disabled={busy !== null} onclick={() => clearSecret(s)}>{t("Remove")}</button>{/if}
              </div>
            {:else}
              <input id={`set-${s.key}`} class="input" type={s.kind === "int" ? "number" : s.kind === "url" ? "url" : "text"} disabled={s.locked} bind:value={draft[s.key]} />
            {/if}
          {/if}
          {#if s.locked}<div class="hint locked">{t("Set by the server ({env})", { env: s.env })}</div>{:else if hint}<div class="hint">{t(hint)}</div>{/if}
        </div>
      {/each}
      <div class="row">
        <button class="btn small" disabled={busy !== null} onclick={() => save(section.id)}>{t("Save")}</button>
        {#if section.id === "smtp"}
          <button class="btn neutral small" disabled={busy !== null} onclick={testMail}>{t("Send me a test e-mail")}</button>
        {/if}
      </div>
    </section>
  {/if}
{/each}

<style>
  .section { border-top: 1px solid var(--divider); padding: 16px 0; max-width: 640px; }
  h2 { font-size: 17px; margin: 0 0 4px; }
  .field { margin: 12px 0; }
  .field label { font-size: 14px; }
  .check { display: flex; gap: 8px; align-items: center; }
  .hint { font-size: 12px; color: var(--text-tertiary); margin-top: 2px; }
  .hint.locked { color: var(--text-secondary); }
  .row { display: flex; gap: 8px; align-items: center; }
  .row .input { flex: 1; }
  .redirect { display: block; font-size: 13px; margin: 4px 0 8px; word-break: break-all; }
</style>
