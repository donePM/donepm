import { branchUpdateBlocker, branchUpdateVia, DEPENDABOT_REBASE, prBranchUpdated, type BranchUpdateVia, type WorkItem } from "@donepm/core";
import { postReply } from "../gh/pr-replies.js";
import type { Exec } from "../process/exec.js";
import { PrActionError, type PrActionDeps } from "./actions.js";

const UPDATE_TIMEOUT_MS = 2 * 60_000;

export type BranchUpdateResult = { ok: true; via: BranchUpdateVia; url?: string } | { ok: false; error: string };

/**
 * Ask for someone else's pull request to be brought up to date with its base, as the user
 * (issue #148, D47). Dependabot gets `@dependabot rebase`: a push by anyone else makes it stop
 * maintaining the PR. Any other branch gets `gh pr update-branch`, GitHub's "Update branch", which
 * merges the base into it (not `--rebase`: that rewrites the author's commits).
 */
export async function requestBranchUpdate(exec: Exec, item: WorkItem): Promise<BranchUpdateResult> {
  const number = Number(item.externalId.split("#")[1]);
  const via = branchUpdateVia(item);
  if (via === "dependabot") {
    const posted = await postReply(exec, { number, url: item.externalUrl }, { body: DEPENDABOT_REBASE });
    return posted.ok ? { ok: true, via, ...(posted.url ? { url: posted.url } : {}) } : { ok: false, error: posted.error };
  }
  const u = new URL(item.externalUrl);
  const [owner, name] = u.pathname.split("/").filter(Boolean);
  if (!owner || !name || !number) return { ok: false, error: `not a pull request URL: ${item.externalUrl}` };
  const r = await exec("gh", ["pr", "update-branch", String(number), "--repo", `${u.host}/${owner}/${name}`], { timeoutMs: UPDATE_TIMEOUT_MS });
  if (r.code !== 0) return { ok: false, error: (r.stderr || r.stdout).trim() || `gh pr update-branch exited with ${r.code}` };
  return { ok: true, via };
}

/**
 * The card's "Update branch" (issue #148): the click is the user's approval, like Merge. Refused
 * unless the last poll read the pull request as behind its base.
 */
export async function updatePrBranch(deps: PrActionDeps & { exec: Exec }, itemId: string): Promise<WorkItem> {
  const stored = deps.items.get(itemId);
  if (!stored) throw new PrActionError(404, "item not found");
  const { item } = stored;
  const blocker = branchUpdateBlocker(item);
  if (blocker) throw new PrActionError(409, `cannot update the branch: ${blocker}`);
  const done = await requestBranchUpdate(deps.exec, item);
  if (!done.ok) throw new PrActionError(502, done.error);
  return deps.writer.commit(prBranchUpdated(item, deps.ctx, done.via));
}
