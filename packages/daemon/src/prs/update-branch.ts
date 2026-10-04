import { branchUpdateBlocker, branchUpdateVia, DEPENDABOT_REBASE, prBranchUpdated, type BranchUpdateVia, type WorkItem } from "@donepm/core";
import { noConnection, type Providers } from "../providers/registry.js";
import { PrActionError, type PrActionDeps } from "./actions.js";

export type BranchUpdateResult = { ok: true; via: BranchUpdateVia; url?: string } | { ok: false; error: string };

/**
 * Ask for someone else's pull request to be brought up to date with its base, as the user
 * (issue #148, D47). Dependabot gets `@dependabot rebase`: a push by anyone else makes it stop
 * maintaining the PR. Any other branch gets the code host's "Update branch", which merges the base
 * into it (not a rebase: that rewrites the author's commits).
 */
export async function requestBranchUpdate(providers: Providers, item: WorkItem): Promise<BranchUpdateResult> {
  const host = providers.codeHost(item.externalUrl);
  if (!host) return { ok: false, error: noConnection(item.externalUrl) };
  const pr = { number: Number(item.externalId.split("#")[1]), url: item.externalUrl };
  const via = branchUpdateVia(item);
  if (via === "dependabot") {
    const posted = await host.reply(pr, { body: DEPENDABOT_REBASE });
    return posted.ok ? { ok: true, via, ...(posted.url ? { url: posted.url } : {}) } : { ok: false, error: posted.error };
  }
  const done = await host.updateBranch(pr);
  return done.ok ? { ok: true, via } : done;
}

/**
 * The card's "Update branch" (issue #148): the click is the user's approval, like Merge. Refused
 * unless the last poll read the pull request as behind its base.
 */
export async function updatePrBranch(deps: PrActionDeps & { providers: Providers }, itemId: string): Promise<WorkItem> {
  const stored = deps.items.get(itemId);
  if (!stored) throw new PrActionError(404, "item not found");
  const { item } = stored;
  const blocker = branchUpdateBlocker(item);
  if (blocker) throw new PrActionError(409, `cannot update the branch: ${blocker}`);
  const done = await requestBranchUpdate(deps.providers, item);
  if (!done.ok) throw new PrActionError(502, done.error);
  return deps.writer.commit(prBranchUpdated(item, deps.ctx, done.via));
}
