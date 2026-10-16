<script lang="ts">
  import { untrack } from "svelte";
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { navigate } from "../lib/router.svelte";
  import { PALETTE } from "../lib/constants";
  import type { Member, SpaceDetail } from "../lib/types";
  import Modal from "./Modal.svelte";
  import { t } from "../lib/i18n.svelte";
  import MarkdownEditor from "./MarkdownEditor.svelte";
  import UserSelect from "./UserSelect.svelte";
  import Avatar from "./Avatar.svelte";
  import Icon from "./Icon.svelte";

  /** Without `team`: creation form. With `team`: settings + governance (admins only). */
  let { team = null, onclose }: { team?: SpaceDetail | null; onclose: () => void } = $props();

  const initial = untrack(() => team);
  let name = $state(initial?.name ?? "");
  let description = $state(initial?.description ?? "");
  let color = $state<string | null>(initial?.color ?? PALETTE[2]);
  let members = $state<Member[]>(initial ? [...initial.members] : []);
  let newMemberId = $state<string | null>(null);
  let newMemberRole = $state<"member" | "admin">("member");
  let busy = $state(false);
  let error = $state("");

  const meId = $derived(app.me!.user.id);

  async function wrap(fn: () => Promise<void>) {
    busy = true;
    error = "";
    try {
      await fn();
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    return wrap(async () => {
      if (team) {
        await api.patch(`/spaces/${team.id}`, { name, description, color });
        app.toast(t("Team updated"));
      } else {
        const { id } = await api.post<{ id: string }>("/spaces", {
          name, description, color,
          members: members.map((m) => ({ userId: m.id, role: m.role })),
        });
        navigate(`/spaces/${id}`);
        app.toast(t("Team created"));
      }
      app.refresh();
      onclose();
    });
  };

  const addMember = () =>
    wrap(async () => {
      const u = app.users.find((x) => x.id === newMemberId);
      if (!u) return;
      if (team) await api.post(`/spaces/${team.id}/members`, { userId: u.id, role: newMemberRole });
      members = [...members.filter((m) => m.id !== u.id), { id: u.id, name: u.name, avatarUrl: u.avatarUrl, role: newMemberRole }];
      newMemberId = null;
      if (team) app.refresh();
    });

  const setRole = (m: Member, role: "admin" | "member") =>
    wrap(async () => {
      if (team) await api.patch(`/spaces/${team.id}/members/${m.id}`, { role });
      members = members.map((x) => (x.id === m.id ? { ...x, role } : x));
      if (team) app.refresh();
    });

  const removeMember = (m: Member) =>
    wrap(async () => {
      if (team) await api.del(`/spaces/${team.id}/members/${m.id}`);
      members = members.filter((x) => x.id !== m.id);
      if (team) app.refresh();
    });

  const removeTeam = () =>
    wrap(async () => {
      if (!team || !confirm(t("Delete the team “{name}” for good?", { name: team.name }))) return;
      await api.del(`/spaces/${team.id}`);
      app.refresh();
      onclose();
      navigate("/");
    });
</script>

<Modal title={team ? t("Settings of {name}", { name: team.name }) : t("New team")} {onclose}>
  <form onsubmit={submit}>
    <div class="field">
      <label for="tm-name">{t("Name")}</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="tm-name" class="input" bind:value={name} required maxlength="120" autofocus={!team} />
    </div>
    <div class="field">
      <span class="label-text">{t("Description")}</span>
      <MarkdownEditor bind:value={description} rows={3} />
    </div>
    <div class="field">
      <span class="label-text">{t("Colour")}</span>
      <div class="swatches">
        {#each PALETTE as c (c)}
          <button type="button" class="swatch" class:selected={color === c} style="background:{c}" aria-label={c} onclick={() => (color = c)}></button>
        {/each}
      </div>
    </div>

    <div class="field">
      <span class="label-text">{t("Members and governance")}</span>
      <p class="hint" style="margin-top:0">{t("Admins manage members and settings: share the governance by promoting other members.")}</p>
      <div class="list">
        {#if !team}
          <div class="list-item static"><Avatar user={app.me?.user} /><span class="title">{t("{name} (you)", { name: app.me?.user.name ?? "" })}</span><span class="badge">{t("Admin")}</span></div>
        {/if}
        {#each members as m (m.id)}
          <div class="list-item static">
            <Avatar user={m} />
            <span class="title">{m.name}{m.id === meId ? " (vous)" : ""}</span>
            <select class="input role" value={m.role} disabled={busy}
              onchange={(e) => setRole(m, (e.currentTarget as HTMLSelectElement).value as "admin" | "member")}>
              <option value="member">{t("Member")}</option>
              <option value="admin">{t("Admin")}</option>
            </select>
            <button type="button" class="btn ghost icon small" title={t("Remove")} disabled={busy} onclick={() => removeMember(m)}>
              <Icon name="close" size={16} />
            </button>
          </div>
        {/each}
      </div>
      <div class="row add">
        <UserSelect bind:value={newMemberId} placeholder={t("Add a person…")} exclude={[meId, ...members.map((m) => m.id)]} />
        <select class="input role" bind:value={newMemberRole}>
          <option value="member">{t("Member")}</option>
          <option value="admin">{t("Admin")}</option>
        </select>
        <button type="button" class="btn neutral" disabled={!newMemberId || busy} onclick={addMember}>{t("Add")}</button>
      </div>
    </div>

    {#if error}<div class="error-text">{error}</div>{/if}
    <div class="modal-actions">
      {#if team}<button type="button" class="btn ghost" onclick={removeTeam}><Icon name="trash" size={16} />{t("Delete")}</button>{/if}
      <span class="spacer"></span>
      <button type="button" class="btn neutral" onclick={onclose}>{team ? t("Close") : t("Cancel")}</button>
      <button class="btn" disabled={busy || !name.trim()}>{team ? t("Save") : t("Create the team")}</button>
    </div>
  </form>
</Modal>

<style>
  .static { cursor: default; padding: 4px 6px; }
  .static:hover { background: none; }
  .role { width: 110px; flex-shrink: 0; min-height: 30px; padding: 2px 6px; font-size: 14px; }
  .add { margin-top: 8px; }
</style>
