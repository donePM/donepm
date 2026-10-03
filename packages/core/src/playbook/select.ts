import type { WorkItem } from "../item/types.js";
import type { Playbook } from "./schema.js";

export function playbookMatches(playbook: Playbook, item: Pick<WorkItem, "source" | "labels">): boolean {
  const m = playbook.match;
  if (!m) return true;
  if (m.source !== undefined && m.source !== item.source) return false;
  if (m.labels !== undefined && m.labels.length > 0) {
    const have = new Set(item.labels.map((l) => l.toLowerCase()));
    if (!m.labels.some((l) => have.has(l.toLowerCase()))) return false;
  }
  return true;
}

export interface Selection {
  /** All playbooks that fit, sorted by name. */
  candidates: Playbook[];
  /** First candidate by name; undefined when none fits. */
  selected: Playbook | undefined;
}

/** MVP rules only (spec 8.3): candidates by `match`, first by name if several. */
export function selectPlaybook(item: Pick<WorkItem, "source" | "labels">, playbooks: Playbook[]): Selection {
  const candidates = playbooks
    .filter((p) => playbookMatches(p, item))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { candidates, selected: candidates[0] };
}
