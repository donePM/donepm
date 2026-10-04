import { ref } from "vue";
import { api } from "../api/client";
import type { PlaybookEntry } from "../api/types";

export interface PlaybookOption {
  name: string;
  /** "implement · opus". */
  label: string;
}

/**
 * The playbooks an item of `repoId` can run: the global ones and the repository's own, a
 * repository playbook replacing the global one of the same name, limited to `allowed`, the ones
 * the repository offers the item's ingest (issue #153). Sorted by name. The item's current playbook
 * stays in the list even when no file defines it any more, so the select shows it.
 */
export function playbookOptions(
  entries: readonly PlaybookEntry[],
  repoId: string | undefined,
  current: string,
  allowed?: readonly string[],
): PlaybookOption[] {
  const byName = new Map<string, PlaybookEntry>();
  for (const e of entries) if (e.scope.kind === "global") byName.set(e.name, e);
  for (const e of entries) if (e.scope.kind === "repo" && e.scope.repoId === repoId) byName.set(e.name, e);
  if (allowed) for (const name of [...byName.keys()]) if (!allowed.includes(name)) byName.delete(name);
  const options = [...byName.values()].map((e) => ({ name: e.name, label: `${e.name} · ${e.model}` }));
  if (!byName.has(current)) options.push({ name: current, label: current });
  return options.sort((a, b) => a.name.localeCompare(b.name));
}

/** All playbooks, loaded once per page for the Ready cards. A failed load leaves the list empty. */
export const playbookEntries = ref<PlaybookEntry[]>([]);
let loading: Promise<void> | undefined;
export function loadPlaybookEntries(): Promise<void> {
  loading ??= api.playbooks().then(
    (list) => {
      playbookEntries.value = list.playbooks;
    },
    () => {
      loading = undefined;
    },
  );
  return loading;
}
