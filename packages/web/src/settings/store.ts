import { ref } from "vue";
import { api, type WorktreeChoice } from "../api/client";
import type { RepoView, Settings } from "../api/types";

/** The settings every section edits, loaded once by the layout and replaced by each save's answer. */
export const settings = ref<Settings>();
export const loadError = ref<string>();

/** The local clones, with their managed flag (Repositories and its nav badge). */
export const repos = ref<RepoView[]>();

export async function loadSettings(): Promise<void> {
  loadError.value = undefined;
  try {
    [settings.value, repos.value] = await Promise.all([api.settings(), api.repos()]);
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e);
  }
}

export type SettingsPatch = Parameters<typeof api.saveSettings>[0];

/** Saves a part of the settings and keeps the shared copy current. */
export async function saveSettings(patch: SettingsPatch, worktrees?: WorktreeChoice) {
  const out = await api.saveSettings(patch, worktrees);
  settings.value = out.settings;
  return out;
}

/** The text of a failed save: zod's issues when the daemon sent them. */
export function saveErrorText(e: unknown): string {
  const body = (e as { body?: { issues?: { path: string; message: string }[] } } | undefined)?.body;
  const issues = body?.issues;
  if (issues?.length) return issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; ");
  return e instanceof Error ? e.message.replace(/^\w+ \S+: /, "") : String(e);
}
