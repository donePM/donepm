import { withPrStatus, type Ctx, type WorkItem } from "@donepm/core";
import { fetchPrStatuses } from "../gh/pr-status.js";
import type { Exec } from "../process/exec.js";
import type { ItemStore } from "./store.js";

export interface PrStatusDeps {
  exec: Exec;
  items: ItemStore;
  ctx: Ctx;
  onItemUpdated: (item: WorkItem) => void;
}

/**
 * Read where someone else's pull requests stand (D47) for every such item on the board of a managed
 * repository, done ones included: a reviewed pull request may still wait for its merge. Closed and
 * archived ones are past that. Changes are stored silently and pushed to the board.
 */
export async function refreshPrStatuses(deps: PrStatusDeps, managed: (origin: string) => boolean): Promise<void> {
  const open = deps.items
    .all()
    .filter(({ item, originUrl }) => item.source === "github-pr" && !item.archivedAt && !item.closedUpstream && managed(originUrl))
    .map(({ item }) => item);
  if (open.length === 0) return;
  const refs = open.map((item) => {
    const [repository, number] = item.externalId.split("#");
    return { repository: repository!, number: Number(number) };
  });
  const read = await fetchPrStatuses(deps.exec, refs);
  for (const item of open) {
    const status = read.get(item.externalId);
    const next = status && withPrStatus(item, status, deps.ctx);
    if (!next) continue;
    deps.items.update(next);
    deps.onItemUpdated(next);
  }
}
