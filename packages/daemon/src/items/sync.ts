import {
  collect, externalIdOf, linkRepo, markClosedUpstream, normalizeOriginUrl, refresh,
  type Ctx, type SourceIssue, type WorkItem,
} from "@donepm/core";
import { transaction, type Db } from "../db/database.js";
import type { EventStore } from "../events/store.js";
import type { RepoStore } from "../repos/store.js";
import type { ItemStore } from "./store.js";

export interface SyncDeps {
  db: Db;
  items: ItemStore;
  events: EventStore;
  repos: RepoStore;
  ctx: Ctx;
}

/** `github.com/owner/repo` for an issue, matching a clone's normalised origin. */
export function issueOrigin(issue: SourceIssue): string {
  return normalizeOriginUrl(`${new URL(issue.url).host}/${issue.repository}`);
}

export interface SyncResult {
  collected: WorkItem[];
  updated: WorkItem[];
  /** Known items that were not in the result, not done and not yet flagged closed. */
  missing: WorkItem[];
}

/**
 * Upsert the polled issues by `externalId` (spec 6.2). New issues become `ready` items with an
 * `item.collected` event. Known items get the latest content. Nothing is deleted.
 */
export function syncIssues(issues: readonly SourceIssue[], deps: SyncDeps): SyncResult {
  const { db, items, events, repos, ctx } = deps;
  return transaction(db, () => {
    const collected: WorkItem[] = [];
    const updated: WorkItem[] = [];
    const seen = new Set<string>();

    for (const issue of issues) {
      const externalId = externalIdOf(issue);
      if (seen.has(externalId)) continue;
      seen.add(externalId);
      const origin = issueOrigin(issue);
      const repoId = repos.byOrigin(origin)?.id;
      const known = items.byExternalId(externalId);

      if (!known) {
        const c = collect(issue, ctx, repoId === undefined ? { priority: items.nextPriority() } : { priority: items.nextPriority(), repoId });
        items.insert(c.item, origin);
        events.append(c.events);
        collected.push(c.item);
        continue;
      }
      const refreshed = refresh(known.item, issue, ctx) ?? known.item;
      const linked = linkRepo(refreshed, repoId, ctx) ?? refreshed;
      if (linked !== known.item) {
        items.update(linked);
        updated.push(linked);
      }
    }

    const missing = items
      .all()
      .map((s) => s.item)
      .filter((i) => !seen.has(i.externalId) && i.state !== "done" && !i.closedUpstream);
    return { collected, updated, missing };
  });
}

/** Flag an item whose issue was confirmed closed upstream. Returns the item if it changed. */
export function applyClosedUpstream(itemId: string, deps: Pick<SyncDeps, "items" | "ctx">): WorkItem | undefined {
  const stored = deps.items.get(itemId);
  if (!stored) return undefined;
  const next = markClosedUpstream(stored.item, deps.ctx);
  if (next) deps.items.update(next);
  return next;
}

/** After a repo scan: link every item to the clone matching its origin, or unlink it. */
export function relinkItems(deps: Omit<SyncDeps, "events">): WorkItem[] {
  const { db, items, repos, ctx } = deps;
  return transaction(db, () => {
    const changed: WorkItem[] = [];
    for (const { item, originUrl } of items.all()) {
      const next = linkRepo(item, repos.byOrigin(originUrl)?.id, ctx);
      if (next) {
        items.update(next);
        changed.push(next);
      }
    }
    return changed;
  });
}
