import {
  closedUpstream, collect, externalIdOf, wasStarted, linkRepo, markClosedUpstream, normalizeOriginUrl, refresh,
  type Ctx, type ItemSource, type SourceIssue, type WorkItem,
} from "@donepm/core";
import { transaction, type Db } from "../db/database.js";
import type { EventStore } from "../events/store.js";
import type { RepoStore } from "../repos/store.js";
import { TombstoneStore, type Tombstone } from "../retention/tombstones.js";
import type { ItemStore } from "./store.js";

export interface SyncDeps {
  db: Db;
  items: ItemStore;
  events: EventStore;
  repos: RepoStore;
  ctx: Ctx;
  /** The playbook a new item of the repository starts with (issue #127, #153); missing: the built-in default. */
  playbookFor?: (origin: string, source: ItemSource) => string | undefined;
}

/**
 * `github.com/owner/repo` for an issue, matching a clone's normalised origin. A ticket's is the
 * repository it goes to (issue #139): its only one, the one chosen for its item, or '' until chosen.
 */
export function issueOrigin(issue: SourceIssue, item?: WorkItem): string {
  if (issue.origins) return item?.repoOrigin ?? (issue.origins.length === 1 ? issue.origins[0]! : "");
  return normalizeOriginUrl(`${new URL(issue.url).host}/${issue.repository}`);
}

export interface SyncResult {
  collected: WorkItem[];
  updated: WorkItem[];
  /**
   * Known items that were not in the result and not yet flagged closed: live ones that are not done,
   * and archived ones, whose closing tells a later reopen apart (D37).
   */
  missing: WorkItem[];
  /** Purged issues not in the result whose closing was not seen yet (D37). */
  openTombstones: Tombstone[];
}

/**
 * Upsert the polled issues by `externalId` (spec 6.2). New issues become `ready` items with an
 * `item.collected` event. Known items get the latest content, and a changed priority, title or
 * labels an `item.refreshed` event (D45). Nothing is deleted. Items not `asked` for (of unmanaged
 * origins, D46, or of a ticket connection that did not search) are never reported missing. Items not in the result are not refreshed (D45).
 *
 * An issue whose item was archived or purged (D37) is skipped while it stays open: its work is
 * finished. Once it was seen closed, its showing up again means it was reopened, and it is
 * collected as a new item; the archived one keeps its own history.
 */
export function syncIssues(
  issues: readonly SourceIssue[],
  deps: SyncDeps,
  asked: (origin: string, externalId: string) => boolean = () => true,
): SyncResult {
  const { db, items, events, repos, ctx } = deps;
  const tombstones = new TombstoneStore(db);
  const finishedBefore = (externalId: string): boolean => {
    const archived = items.latestArchived(externalId)?.item;
    const tombstone = tombstones.get(externalId);
    if (archived ? !archived.closedUpstream : tombstone && !tombstone.closed) return true;
    if (tombstone) tombstones.remove(externalId);
    return false;
  };
  return transaction(db, () => {
    const collected: WorkItem[] = [];
    const updated: WorkItem[] = [];
    const seen = new Set<string>();

    for (const issue of issues) {
      const externalId = externalIdOf(issue);
      if (seen.has(externalId)) continue;
      seen.add(externalId);
      const known = items.byExternalId(externalId);

      if (!known) {
        const origin = issueOrigin(issue);
        const repoId = origin ? repos.byOrigin(origin)?.id : undefined;
        if (finishedBefore(externalId)) continue;
        const playbook = deps.playbookFor?.(origin, issue.source ?? "github-issue");
        const c = collect(issue, ctx, { ...(repoId === undefined ? {} : { repoId }), ...(playbook ? { playbook } : {}) });
        items.insert(c.item, origin);
        events.append(c.events);
        collected.push(c.item);
        continue;
      }
      const r = refresh(known.item, issue, ctx);
      const refreshed = r?.item ?? known.item;
      const origin = issueOrigin(issue, issue.origins ? refreshed : undefined);
      const repoId = origin ? repos.byOrigin(origin)?.id : undefined;
      const linked = linkRepo(refreshed, repoId, ctx) ?? refreshed;
      if (linked !== known.item) {
        items.update(linked);
        if (r) events.append(r.events);
        updated.push(linked);
      }
    }

    const missing = items
      .all()
      .filter((s) => asked(s.originUrl, s.item.externalId))
      .map((s) => s.item)
      .filter((i) => !seen.has(i.externalId) && !i.closedUpstream && (i.state !== "done" || i.archivedAt !== undefined));
    const openTombstones = tombstones.open().filter((t) => asked(t.originUrl, t.externalId) && !seen.has(t.externalId));
    return { collected, updated, missing, openTombstones };
  });
}

/**
 * An item whose issue was confirmed closed upstream (D32). A never-started ready item moves to Done
 * with an `item.closed_upstream` event; any other gets the badge and waits for the user's Dismiss.
 * Returns the item if it changed.
 */
export function applyClosedUpstream(itemId: string, deps: Pick<SyncDeps, "db" | "items" | "events" | "ctx">): WorkItem | undefined {
  const stored = deps.items.get(itemId);
  if (!stored) return undefined;
  const { item } = stored;
  if (item.state === "ready" && !wasStarted(item)) {
    const t = closedUpstream(item, deps.ctx);
    transaction(deps.db, () => {
      deps.items.update(t.item);
      deps.events.append(t.events);
    });
    return t.item;
  }
  const next = markClosedUpstream(item, deps.ctx);
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
