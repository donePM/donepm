import { autoMergeDue, autoMergeFailed, autoMergeSet, InvalidTransitionError, mergeBlockers, reviewedPrMerged, type MergeMethod, type WorkItem } from "@donepm/core";
import type { Config } from "../config/config.js";
import type { Log } from "../log.js";
import { noConnection, type Providers } from "../providers/registry.js";
import type { Done } from "../providers/result.js";
import { PrActionError, type PrActionDeps } from "./actions.js";

export type MergeDeps = PrActionDeps & { providers: Providers };

/** The repository's merge settings for someone else's pull request (D47). */
export function mergeDefaults(sources: Config["sources"], origin: string): { auto: boolean; method: MergeMethod } {
  const s = sources[origin];
  return { auto: s?.autoMerge ?? false, method: s?.mergeMethod ?? "squash" };
}

/** Merge as the user, through the pull request's code host. */
async function merge(providers: Providers, item: WorkItem, method: MergeMethod): Promise<Done> {
  const host = providers.codeHost(item.externalUrl);
  if (!host) return { ok: false, error: noConnection(item.externalUrl) };
  return host.merge({ number: Number(item.externalId.split("#")[1]), url: item.externalUrl }, method);
}

function prItem(deps: PrActionDeps, itemId: string): WorkItem {
  const stored = deps.items.get(itemId);
  if (!stored) throw new PrActionError(404, "item not found");
  if (stored.item.source !== "github-pr") throw new PrActionError(409, "only someone else's pull request is merged from its card");
  return stored.item;
}

/**
 * The card's Merge button (D47): the click is the user's approval. Refused unless the user approved
 * the pull request, its checks passed and GitHub says it is mergeable, as of the last poll.
 */
export async function mergePr(deps: MergeDeps, itemId: string, method: MergeMethod): Promise<WorkItem> {
  const item = prItem(deps, itemId);
  const blockers = mergeBlockers(item);
  if (blockers.length) throw new PrActionError(409, `cannot merge yet: ${blockers.join(", ")}`);
  const merged = await merge(deps.providers, item, method);
  if (!merged.ok) throw new PrActionError(502, merged.error);
  return deps.writer.commit(reviewedPrMerged(item, deps.ctx, { method, auto: false }));
}

/** The card's "Merge automatically" checkbox (D47). */
export function setAutoMerge(deps: PrActionDeps, itemId: string, on: boolean): WorkItem {
  const item = prItem(deps, itemId);
  try {
    return deps.writer.commit(autoMergeSet(item, deps.ctx, on));
  } catch (e) {
    if (e instanceof InvalidTransitionError) throw new PrActionError(409, `cannot do that with a ${e.from} item`);
    throw e;
  }
}

/**
 * Part of each poll, after the pull request statuses were read (D47): merges every pull request
 * whose item has auto-merge on (its own choice, else the repository's) and that is ready. A failure
 * is recorded; one that passes on its own (the branch is behind its base, …) keeps auto-merge on
 * until the pull request's head or merge state changes, any other turns it off for that item.
 */
export async function autoMergeReady(
  deps: MergeDeps & { log: Log },
  sources: Config["sources"],
  managed: (origin: string) => boolean,
): Promise<void> {
  for (const { item, originUrl } of deps.items.all()) {
    if (item.source !== "github-pr" || item.archivedAt || !managed(originUrl)) continue;
    const defaults = mergeDefaults(sources, originUrl);
    if (!autoMergeDue(item, defaults.auto)) continue;
    try {
      const merged = await merge(deps.providers, item, defaults.method);
      const t = merged.ok
        ? reviewedPrMerged(item, deps.ctx, { method: defaults.method, auto: true })
        : autoMergeFailed(item, deps.ctx, { method: defaults.method, error: merged.error });
      deps.writer.commit(t);
      if (merged.ok) deps.log.info({ itemId: item.id, externalId: item.externalId, method: defaults.method }, "pull request merged automatically");
      else deps.log.warn({ itemId: item.id, externalId: item.externalId, error: merged.error, staysOn: t.item.autoMerge !== false }, "automatic merge failed");
    } catch (e) {
      deps.log.warn({ itemId: item.id, err: e }, "automatic merge failed");
    }
  }
}
