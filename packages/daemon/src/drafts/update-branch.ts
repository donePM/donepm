import { branchUpdateBlocker, branchUpdateVia, draftCreated, draftTitle, type UpdateBranchDraft } from "@donepm/core";
import { issueNumber } from "../worktrees/create.js";
import { DraftError, draftableItem, type DraftDeps } from "./actions.js";

/**
 * `draft_update_branch` (issue #148): the review agent proposes bringing someone else's pull request
 * up to date with its base. The daemon adds the PR and how; it is refused unless the last poll read
 * the branch as behind. The user approves; the daemon asks as the user, and the agent goes on.
 */
export function createUpdateBranchDraft(deps: DraftDeps, itemId: string, input: { reason: string }): UpdateBranchDraft {
  const item = draftableItem(deps, itemId);
  if (item.source !== "github-pr") throw new DraftError(409, "draft_update_branch is only for a pull request under review");
  const blocker = branchUpdateBlocker(item);
  if (blocker) throw new DraftError(409, `the branch cannot be updated: ${blocker} (as of the last poll)`);
  const draft: UpdateBranchDraft = {
    id: deps.ctx.newId(),
    itemId,
    type: "update_branch",
    payload: { number: issueNumber(item.externalId), url: item.externalUrl, base: item.prStatus!.base, via: branchUpdateVia(item), reason: input.reason.trim() },
    state: "pending",
  };
  deps.drafts.insert(draft, deps.ctx.now());
  deps.writer.commit(draftCreated(item, deps.ctx, draft.id, { type: "update_branch", title: draftTitle(draft) }));
  return draft;
}
