import type { ItemState } from "@donepm/core";
import type { ItemView } from "../api/types";

export type ColumnKey = "ready" | "in_progress" | "needs_you" | "done";

export const COLUMNS: { key: ColumnKey; title: string }[] = [
  { key: "ready", title: "Ready" },
  { key: "in_progress", title: "In Progress" },
  { key: "needs_you", title: "Needs You" },
  { key: "done", title: "Done" },
];

/** A failed agent needs the user (spec §12.1), so it lands in Needs You. */
const COLUMN_OF: Record<ItemState, ColumnKey> = {
  ready: "ready",
  running: "in_progress",
  needs_you: "needs_you",
  failed: "needs_you",
  done: "done",
};

export function columnOf(item: ItemView): ColumnKey {
  return COLUMN_OF[item.state];
}

/**
 * Items per column. Ready keeps the user's priority order, with items that cannot start
 * (no local clone) at the end. Done shows the most recently finished first.
 */
export function groupByColumn(items: readonly ItemView[]): Record<ColumnKey, ItemView[]> {
  const out: Record<ColumnKey, ItemView[]> = { ready: [], in_progress: [], needs_you: [], done: [] };
  for (const item of items) out[columnOf(item)].push(item);
  const startable = (i: ItemView) => (i.repo ? 0 : 1);
  out.ready.sort((a, b) => startable(a) - startable(b) || a.priority - b.priority);
  out.in_progress.sort((a, b) => a.priority - b.priority);
  out.needs_you.sort((a, b) => a.priority - b.priority);
  out.done.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

/** `owner/repo#12` → `owner/repo #12`, as on the cards. */
export function displayId(externalId: string): string {
  return externalId.replace(/#(\d+)$/, " #$1");
}

export type LabelTone = "bug" | "feature" | "plain";

export function labelTone(label: string): LabelTone {
  const l = label.toLowerCase();
  if (/bug|defect|regression/.test(l)) return "bug";
  if (/feature|enhancement/.test(l)) return "feature";
  return "plain";
}
