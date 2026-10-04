import { normalizeOriginUrl } from "@donepm/core";
import type { ItemView } from "../api/types";
import { COLUMNS, groupByColumn, type ColumnKey } from "./columns";

/** Items without a local clone have no repo to group by; they share one lane. */
export const NO_CLONE_KEY = "no-clone";
export const NO_CLONE_NAME = "No local clone";
/** Tickets of several repositories wait in one lane for the user to pick theirs (issue #139). */
export const CHOOSE_REPO_KEY = "choose-repo";
export const CHOOSE_REPO_NAME = "Choose a repository";

const awaitingRepo = (item: ItemView) => item.repoCandidates !== undefined && !item.repoOrigin;

/** One repository's slice of the board. */
export interface Lane {
  /** `repo.id`, or `NO_CLONE_KEY`. */
  key: string;
  /** `owner/repo`, or `NO_CLONE_NAME`. */
  name: string;
  columns: Record<ColumnKey, ItemView[]>;
  counts: Record<ColumnKey, number>;
}

/**
 * `github.com/acme/widgets` → `acme/widgets`. A repository on another host keeps it
 * (`github.acme.com/team/app`), so two of the same name get two lanes that tell them apart (issue #140).
 */
export function repoName(originUrl: string): string {
  const origin = normalizeOriginUrl(originUrl);
  return origin.startsWith("github.com/") ? origin.slice("github.com/".length) : origin;
}

/** One lane per repo that has items, in first-seen order; use `sortLanes` for display. */
export function buildLanes(items: readonly ItemView[]): Lane[] {
  const byKey = new Map<string, { name: string; items: ItemView[] }>();
  for (const item of items) {
    const key = item.repo?.id ?? (awaitingRepo(item) ? CHOOSE_REPO_KEY : NO_CLONE_KEY);
    let group = byKey.get(key);
    if (!group) {
      group = { name: item.repo ? repoName(item.repo.originUrl) : key === CHOOSE_REPO_KEY ? CHOOSE_REPO_NAME : NO_CLONE_NAME, items: [] };
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

/** The ordering rule: tickets to place, then lanes that need you, then by name; "No local clone" always last. */
export function sortLanes(lanes: readonly Lane[]): Lane[] {
  const rank = (l: Lane) => (l.key === CHOOSE_REPO_KEY ? -1 : l.key === NO_CLONE_KEY ? 2 : l.counts.needs_you > 0 ? 0 : 1);
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

const SUMMARY_WORDS: Record<ColumnKey, string> = { ready: "ready", in_progress: "in progress", needs_you: "need you", done: "done" };

/** A lane's header: "6 items" when open, what is in it when collapsed: "4 ready · 1 need you". */
export function laneSummary(lane: Lane, collapsed: boolean): string {
  const total = COLUMNS.reduce((n, c) => n + lane.counts[c.key], 0);
  if (!collapsed) return `${total} ${total === 1 ? "item" : "items"}`;
  return COLUMNS.filter((c) => lane.counts[c.key] > 0)
    .map((c) => `${lane.counts[c.key]} ${c.key === "needs_you" && lane.counts[c.key] === 1 ? "needs you" : SUMMARY_WORDS[c.key]}`)
    .join(" · ");
}

/** Open Dependabot pull requests in a lane; a collapsed lane names them in a badge. */
export function dependabotCount(lane: Lane): number {
  return COLUMNS.filter((c) => c.key !== "done")
    .flatMap((c) => lane.columns[c.key])
    .filter((i) => i.source === "github-pr" && i.author?.replace(/\[bot\]$/, "") === "dependabot").length;
}
