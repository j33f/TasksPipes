<script lang="ts" module>
  /** A file shown in a "files" field: uploaded (with an id) or waiting to be sent with a new task. */
  export interface FieldFile {
    id?: string;
    field: string;
    name: string;
    size: number;
    file?: File;
  }

  export function formatSize(n: number): string {
    if (n < 1024) return `${n} o`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
    return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
  }

  /** France Compétences page of an RNCP or RS certification. */
  export function rncpUrl(code: string | null | undefined): string | null {
    const m = code?.match(/^(RNCP|RS)(\d+)$/);
    return m ? `https://www.francecompetences.fr/recherche/${m[1].toLowerCase()}/${m[2]}/` : null;
  }
</script>

<script lang="ts">
  import { app } from "../lib/app.svelte";
  import { MAX_FILE_SIZE } from "../lib/api";
  import { formatDate } from "../lib/constants";
  import type { DocRef, Field, RncpValue, TaskType } from "../lib/types";
  import Icon from "./Icon.svelte";
  import DocPicker from "./DocPicker.svelte";
  import UserSelect from "./UserSelect.svelte";
  import { intlLocale, t } from "../lib/i18n.svelte";

  let { type, values, files = [], editable = true, onchange, onupload, ondeletefile }: {
    type: TaskType;
    values: Record<string, unknown>;
    files?: FieldFile[];
    editable?: boolean;
    /** Called when a field is committed (blur, choice…); null clears it. */
    onchange: (fieldId: string, value: unknown) => void;
    onupload: (fieldId: string, files: File[]) => void;
    ondeletefile: (file: FieldFile) => void;
  } = $props();

  const wide = (f: Field) => ["textarea", "multiselect", "docs", "files", "rncp"].includes(f.type);
  const money = $derived(new Intl.NumberFormat(intlLocale(), { style: "currency", currency: "EUR" }));
  const num = $derived(new Intl.NumberFormat(intlLocale()));
  /** How a stored choice reads in the current language. */
  const optionLabel = (f: Field, o: string) => f.optionLabels?.[f.options?.indexOf(o) ?? -1] ?? o;

  const isEmpty = (f: Field) =>
    f.type === "files" ? !files.some((x) => x.field === f.id) : values[f.id] === undefined || values[f.id] === null;
  const shown = $derived(editable ? type.fields : type.fields.filter((f) => !isEmpty(f)));

  function commitText(f: Field, raw: string) {
    const v = raw.trim();
    if (v === String(values[f.id] ?? "")) return;
    onchange(f.id, v || null);
  }

  function commitNumber(f: Field, raw: string) {
    const v = raw === "" ? null : Number(raw);
    if (v === (values[f.id] ?? null)) return;
    onchange(f.id, v);
  }

  function toggleOption(f: Field, option: string) {
    const current = (values[f.id] as string[] | undefined) ?? [];
    const next = current.includes(option) ? current.filter((o) => o !== option) : [...current, option];
    onchange(f.id, next.length ? next : null);
  }

  function commitRncp(f: Field, part: "code" | "title", raw: string) {
    const current = (values[f.id] as RncpValue | undefined) ?? { code: null, title: null };
    let v = raw.trim();
    if (part === "code") v = v.toUpperCase().replace(/[\s-]/g, "");
    if (v === (current[part] ?? "")) return;
    const next = { ...current, [part]: v || null };
    onchange(f.id, next.code || next.title ? next : null);
  }

  function addDoc(f: Field, doc: DocRef) {
    const current = (values[f.id] as DocRef[] | undefined) ?? [];
    if (current.some((d) => d.id === doc.id)) return;
    onchange(f.id, [...current, { id: doc.id, title: doc.title, url: doc.url }]);
  }

  function removeDoc(f: Field, id: string) {
    const next = ((values[f.id] as DocRef[] | undefined) ?? []).filter((d) => d.id !== id);
    onchange(f.id, next.length ? next : null);
  }

  function pickFiles(f: Field, input: HTMLInputElement) {
    const list = [...(input.files ?? [])];
    input.value = "";
    const tooBig = list.filter((x) => x.size > MAX_FILE_SIZE);
    if (tooBig.length) app.toast(t("Too large (50 MB max): {files}", { files: tooBig.map((x) => x.name).join(", ") }), "error");
    const ok = list.filter((x) => x.size <= MAX_FILE_SIZE);
    if (ok.length) onupload(f.id, ok);
  }

  const userName = (id: unknown) => app.users.find((u) => u.id === id)?.name ?? "—";
</script>

{#if !shown.length}
  {#if !editable}<p class="muted small">{t("No information filled in.")}</p>{/if}
{:else}
  <div class="fields">
    {#each shown as f (f.id)}
      {@const v = values[f.id]}
      <div class="field" class:wide={wide(f)}>
        <span class="label-text">{f.label}</span>

        {#if f.type === "files"}
          {@const list = files.filter((x) => x.field === f.id)}
          {#if list.length}
            <ul class="files">
              {#each list as file (file.id ?? file.name)}
                <li>
                  <Icon name="doc" size={16} />
                  {#if file.id}
                    <a href={`/api/files/${file.id}`} target="_blank" rel="noreferrer" class="ellipsis">{file.name}</a>
                    <a class="muted dl" href={`/api/files/${file.id}?download`} title={t("Download")} aria-label={t("Download")}><Icon name="arrow" size={14} /></a>
                  {:else}
                    <span class="ellipsis">{file.name}</span>
                  {/if}
                  <span class="muted small">{formatSize(file.size)}</span>
                  {#if editable}
                    <button type="button" class="btn ghost icon small" title={t("Remove")} onclick={() => ondeletefile(file)}><Icon name="close" size={14} /></button>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
          {#if editable}
            <label class="btn neutral small upload">
              <Icon name="plus" size={16} />{t("Add files")}
              <input type="file" multiple onchange={(e) => pickFiles(f, e.currentTarget as HTMLInputElement)} />
            </label>
          {/if}

        {:else if f.type === "docs"}
          {@const docs = (v as DocRef[] | undefined) ?? []}
          {#if docs.length}
            <div class="row wrap docs">
              {#each docs as d (d.id)}
                <span class="doc-link">
                  <Icon name="doc" size={16} /><a href={d.url ?? "#"} target="_blank" rel="noreferrer"><span>{d.title}</span></a>
                  {#if editable}<button type="button" class="x" title={t("Remove")} onclick={() => removeDoc(f, d.id)}><Icon name="close" size={12} /></button>{/if}
                </span>
              {/each}
            </div>
          {/if}
          {#if editable}<DocPicker onselect={(d) => addDoc(f, d)} />{/if}

        {:else if !editable}
          <div class="value">
            {#if f.type === "money"}{money.format(v as number)}
            {:else if f.type === "number"}{num.format(v as number)}
            {:else if f.type === "date"}{formatDate(v as string)}
            {:else if f.type === "checkbox"}{t("Yes")}
            {:else if f.type === "multiselect"}{(v as string[]).map((o) => optionLabel(f, o)).join(", ")}
            {:else if f.type === "select"}{optionLabel(f, v as string)}
            {:else if f.type === "user"}{userName(v)}
            {:else if f.type === "url"}<a href={v as string} target="_blank" rel="noreferrer">{v}</a>
            {:else if f.type === "email"}<a href={`mailto:${v}`}>{v}</a>
            {:else if f.type === "phone"}<a href={`tel:${v}`}>{v}</a>
            {:else if f.type === "rncp"}
              {@const r = v as RncpValue}
              {#if r.code}
                {#if rncpUrl(r.code)}<a href={rncpUrl(r.code)} target="_blank" rel="noreferrer"><strong>{r.code}</strong></a>{:else}<strong>{r.code}</strong>{/if}
              {/if}
              {r.title ?? ""}
            {:else if f.type === "textarea"}<span class="pre">{v}</span>
            {:else}{v}{/if}
          </div>

        {:else if f.type === "textarea"}
          <textarea class="input" rows="3" value={(v as string) ?? ""} onchange={(e) => commitText(f, e.currentTarget.value)}></textarea>
        {:else if f.type === "number" || f.type === "money"}
          <div class="suffixed">
            <input class="input" type="number" step="any" value={v ?? ""} onchange={(e) => commitNumber(f, e.currentTarget.value)} />
            {#if f.type === "money"}<span class="suffix">€</span>{/if}
          </div>
        {:else if f.type === "date"}
          <input class="input" type="date" value={(v as string) ?? ""} onchange={(e) => onchange(f.id, e.currentTarget.value || null)} />
        {:else if f.type === "select"}
          <select class="input" value={(v as string) ?? ""} onchange={(e) => onchange(f.id, e.currentTarget.value || null)}>
            <option value="">—</option>
            {#each f.options ?? [] as o (o)}<option value={o}>{optionLabel(f, o)}</option>{/each}
          </select>
        {:else if f.type === "multiselect"}
          <div class="chips">
            {#each f.options ?? [] as o (o)}
              <button type="button" class="chip" class:on={((v as string[] | undefined) ?? []).includes(o)} onclick={() => toggleOption(f, o)}>{optionLabel(f, o)}</button>
            {/each}
          </div>
        {:else if f.type === "checkbox"}
          <label class="check"><input type="checkbox" checked={v === true} onchange={(e) => onchange(f.id, e.currentTarget.checked || null)} />{t("Yes")}</label>
        {:else if f.type === "user"}
          <UserSelect value={(v as string) ?? null} placeholder="—" onchange={(id) => onchange(f.id, id)} />
        {:else if f.type === "rncp"}
          {@const r = (v as RncpValue | undefined) ?? { code: null, title: null }}
          <div class="rncp">
            <input class="input code" placeholder={t("RNCP37873 or RS5487")} value={r.code ?? ""} onchange={(e) => commitRncp(f, "code", e.currentTarget.value)} />
            <input class="input" placeholder={t("Name of the qualification")} value={r.title ?? ""} onchange={(e) => commitRncp(f, "title", e.currentTarget.value)} />
          </div>
          {#if rncpUrl(r.code)}
            <a class="small" href={rncpUrl(r.code)} target="_blank" rel="noreferrer">{t("See {code} on France Compétences", { code: r.code ?? "" })}</a>
          {/if}
        {:else}
          <input class="input" type={f.type === "email" ? "email" : f.type === "url" ? "url" : f.type === "phone" ? "tel" : "text"}
            value={(v as string) ?? ""} onchange={(e) => commitText(f, e.currentTarget.value)} />
        {/if}
        {#if f.hint && editable}<div class="hint">{f.hint}</div>{/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; }
  .field { margin-bottom: 12px; min-width: 0; }
  .field.wide { grid-column: 1 / -1; }
  .value { font-size: 14px; min-height: 22px; word-break: break-word; }
  .pre { white-space: pre-wrap; }
  .files { list-style: none; margin: 0 0 6px; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .files li { display: flex; align-items: center; gap: 6px; font-size: 14px; min-height: 28px; }
  .ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .dl :global(svg) { transform: rotate(90deg); }
  .upload { position: relative; overflow: hidden; cursor: pointer; }
  .upload input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
  .docs { gap: 6px; margin-bottom: 6px; }
  .docs a { color: inherit; display: flex; min-width: 0; }
  .x { border: 0; background: none; padding: 2px; cursor: pointer; color: var(--text-tertiary); display: flex; }
  .suffixed { position: relative; }
  .suffixed .input { width: 100%; padding-right: 26px; }
  .suffix { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary); font-size: 14px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { border: 1px solid var(--input-border); background: none; color: var(--text-secondary); border-radius: 14px; padding: 3px 10px; font-size: 13px; cursor: pointer; font-family: inherit; }
  .chip.on { border-color: var(--accent); background: var(--accent); color: #fff; }
  .check { display: flex; align-items: center; gap: 8px; font-size: 14px; min-height: 36px; }
  .rncp { display: grid; grid-template-columns: 170px 1fr; gap: 8px; margin-bottom: 4px; }
  textarea.input { min-height: 72px; }
  @media (max-width: 600px) {
    .fields { grid-template-columns: 1fr; }
    .rncp { grid-template-columns: 1fr; }
  }
</style>
