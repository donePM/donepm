import { parseExternalId, withPrStatus, type Ctx, type PrStatus, type WorkItem } from "@donepm/core";
import type { CodeHost, PrRef } from "../providers/code-host.js";
import type { Providers } from "../providers/registry.js";
import type { ItemStore } from "./store.js";

export interface PrStatusDeps {
  providers: Providers;
  items: ItemStore;
  ctx: Ctx;
  onItemUpdated: (item: WorkItem) => void;
}

/**
 * Read where someone else's pull requests stand (D47) for every such item on the board of a managed
 * repository, done ones included: a reviewed pull request may still wait for its merge. Closed and
 * archived ones, and those GitHub reported merged or closed, are past that. Changes are stored silently and pushed to the board.
 */
export async function refreshPrStatuses(deps: PrStatusDeps, managed: (origin: string) => boolean): Promise<void> {
  const stored = deps.items
    .all()
    .filter(({ item, originUrl }) => item.source === "github-pr" && !item.archivedAt && !item.closedUpstream && isOpen(item) && managed(originUrl));
  if (stored.length === 0) return;
  const byHost = new Map<CodeHost, PrRef[]>();
  for (const { item, originUrl } of stored) {
    const host = deps.providers.codeHost(originUrl);
    if (!host) continue;
    const ref = parseExternalId(item.externalId);
    if (!ref) continue;
    byHost.set(host, [...(byHost.get(host) ?? []), { repository: ref.repository, number: ref.number }]);
  }
  const read = new Map<string, PrStatus>();
  for (const [host, refs] of byHost) for (const [key, status] of await host.prStatuses(refs)) read.set(key, status);
  const open = stored.map(({ item }) => item);
  for (const item of open) {
    const status = read.get(item.externalId);
    const next = status && withPrStatus(item, status, deps.ctx);
    if (!next) continue;
    deps.items.update(next);
    deps.onItemUpdated(next);
  }
}

/** Not known to be merged or closed yet. */
function isOpen(item: WorkItem): boolean {
  return !item.prStatus?.state || item.prStatus.state === "OPEN";
}
