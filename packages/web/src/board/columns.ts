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

/** Milliseconds since the epoch; timestamps from GitHub and from the daemon differ in format. */
function time(iso: string | undefined): number {
  return iso === undefined ? 0 : Date.parse(iso) || 0;
}

/** Last tie-break, so the order is total: `acme/widgets#9` before `acme/widgets#10`. */
function byExternalId(a: ItemView, b: ItemView): number {
  return a.externalId.localeCompare(b.externalId, "en", { numeric: true });
}

/** Most urgent first, then the oldest issue. Items that cannot start (no local clone) go last. */
function readyOrder(a: ItemView, b: ItemView): number {
  const startable = (i: ItemView) => (i.repo ? 0 : 1);
  const opened = (i: ItemView) => time(i.issueCreatedAt ?? i.createdAt);
  return startable(a) - startable(b) || a.priority - b.priority || opened(a) - opened(b) || byExternalId(a, b);
}

/** First started on top. `startedAt` survives a trip through Needs You, so a card keeps its place. */
function inProgressOrder(a: ItemView, b: ItemView): number {
  const started = (i: ItemView) => time(i.startedAt ?? i.stateSince);
  return started(a) - started(b) || byExternalId(a, b);
}

/** Who waits longest is on top. */
function needsYouOrder(a: ItemView, b: ItemView): number {
  return time(a.stateSince) - time(b.stateSince) || byExternalId(a, b);
}

/** Newest finished on top. Later updates (title sync, worktree removal) do not move a card. */
function doneOrder(a: ItemView, b: ItemView): number {
  return time(b.stateSince) - time(a.stateSince) || byExternalId(a, b);
}

/** Items per column, each in its fixed order (spec §12.1). */
export function groupByColumn(items: readonly ItemView[]): Record<ColumnKey, ItemView[]> {
  const out: Record<ColumnKey, ItemView[]> = { ready: [], in_progress: [], needs_you: [], done: [] };
  for (const item of items) out[columnOf(item)].push(item);
  out.ready.sort(readyOrder);
  out.in_progress.sort(inProgressOrder);
  out.needs_you.sort(needsYouOrder);
  out.done.sort(doneOrder);
  return out;
}

/** `owner/repo#12` → `owner/repo #12`, as on the cards. */
export function displayId(externalId: string): string {
  return externalId.replace(/#(\d+)$/, " #$1");
}

/** `owner/repo#12` → `#12`, for cards in a lane that already names the repo. */
export function shortId(externalId: string): string {
  return externalId.replace(/^.*(?=#\d+$)/, "");
}

export type LabelTone = "bug" | "feature" | "plain";

export function labelTone(label: string): LabelTone {
  const l = label.toLowerCase();
  if (/bug|defect|regression/.test(l)) return "bug";
  if (/feature|enhancement/.test(l)) return "feature";
  return "plain";
}
