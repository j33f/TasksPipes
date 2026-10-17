import { t } from "./i18n.svelte";
import type { TaskLink } from "./types";

/** Colours of pull/merge request states, as on GitHub. */
export const GIT_STATE_COLOR: Record<TaskLink["state"], string> = {
  draft: "#8b949e",
  open: "#3fb950",
  merged: "#a371f7",
  closed: "#f85149",
  pushed: "#8b949e",
};

/** Label of a state (shown with t()). */
export const GIT_STATE_LABEL: Record<TaskLink["state"], string> = {
  draft: "Draft",
  open: "Open",
  merged: "Merged",
  closed: "Closed",
  pushed: "Pushed",
};

export const gitKindLabel = (kind: TaskLink["kind"]) =>
  kind === "pull_request" ? t("pull request") : kind === "merge_request" ? t("merge request") : t("commit");

/** A branch name that links its pull/merge request to the task: tp-123-short-title. */
export function branchName(key: string, title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .split("-")
    .slice(0, 6)
    .join("-");
  return slug ? `${key.toLowerCase()}-${slug}` : key.toLowerCase();
}
