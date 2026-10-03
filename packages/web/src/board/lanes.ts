import { normalizeOriginUrl } from "@donepm/core";
import type { ItemView } from "../api/types";
import { COLUMNS, groupByColumn, type ColumnKey } from "./columns";

/** Items without a local clone have no repo to group by; they share one lane. */
export const NO_CLONE_KEY = "no-clone";
export const NO_CLONE_NAME = "No local clone";

/** One repository's slice of the board. */
export interface Lane {
  /** `repo.id`, or `NO_CLONE_KEY`. */
  key: string;
  /** `owner/repo`, or `NO_CLONE_NAME`. */
  name: string;
  columns: Record<ColumnKey, ItemView[]>;
  counts: Record<ColumnKey, number>;
}

/** `github.com/acme/widgets` → `acme/widgets`. Without a host segment the input is returned as is. */
export function repoName(originUrl: string): string {
  const origin = normalizeOriginUrl(originUrl);
  const slash = origin.indexOf("/");
  return slash === -1 ? origin : origin.slice(slash + 1);
}

/** One lane per repo that has items, in first-seen order; use `sortLanes` for display. */
export function buildLanes(items: readonly ItemView[]): Lane[] {
  const byKey = new Map<string, { name: string; items: ItemView[] }>();
  for (const item of items) {
    const key = item.repo?.id ?? NO_CLONE_KEY;
    let group = byKey.get(key);
    if (!group) {
      group = { name: item.repo ? repoName(item.repo.originUrl) : NO_CLONE_NAME, items: [] };
      byKey.set(key, group);
    }
    group.items.push(item);
  }
  return [...byKey].map(([key, { name, items }]) => {
    const columns = groupByColumn(items);
    const counts = Object.fromEntries(COLUMNS.map((c) => [c.key, columns[c.key].length])) as Record<ColumnKey, number>;
    return { key, name, columns, counts };
  });
}

/** The ordering rule: lanes that need you first, then by name; "No local clone" always last. */
export function sortLanes(lanes: readonly Lane[]): Lane[] {
  const rank = (l: Lane) => (l.key === NO_CLONE_KEY ? 2 : l.counts.needs_you > 0 ? 0 : 1);
  return [...lanes].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}

/**
 * Keeps lanes where they were while the page is open, so a card finishing does not make the
 * lane jump under the pointer. `lanes` come in rule order (`sortLanes`); those in `previousKeys`
 * keep that relative order, new ones follow in rule order, "No local clone" stays last.
 */
export function stableOrder(lanes: readonly Lane[], previousKeys: readonly string[]): Lane[] {
  const byKey = new Map(lanes.map((l) => [l.key, l]));
  const known = previousKeys.flatMap((k) => byKey.get(k) ?? []);
  const seen = new Set(previousKeys);
  const added = lanes.filter((l) => !seen.has(l.key));
  const out = [...known, ...added];
  return [...out.filter((l) => l.key !== NO_CLONE_KEY), ...out.filter((l) => l.key === NO_CLONE_KEY)];
}
