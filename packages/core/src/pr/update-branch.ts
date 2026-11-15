import type { Ctx } from "../ids.js";
import { InvalidTransitionError, type Transition } from "../item/transitions.js";
import type { WorkItem } from "../item/types.js";

/** Dependabot's own command to bring its branch up to date with the base (D47). */
export const DEPENDABOT_REBASE = "@dependabot rebase";

/**
 * How donePM asks for the branch of someone else's pull request to be updated (issue #148, D47):
 * Dependabot is asked to rebase (a push by someone else makes it stop maintaining the PR); any
 * other branch gets GitHub's "Update branch", a merge of the base.
 */
export type BranchUpdateVia = "dependabot" | "update-branch";

export function branchUpdateVia(item: Pick<WorkItem, "author">): BranchUpdateVia {
  return item.author === "dependabot[bot]" ? "dependabot" : "update-branch";
}

/**
 * Why the branch cannot be updated from donePM, or undefined when it can: someone else's open pull
 * request that GitHub reported behind its base (`mergeState` `BEHIND`) on the last poll.
 */
export function branchUpdateBlocker(item: Pick<WorkItem, "source" | "prStatus">): string | undefined {
  if (item.source !== "github-pr") return "not someone else's pull request";
  const s = item.prStatus;
  if (!s) return "status not read yet";
  if (s.state !== undefined && s.state !== "OPEN") return `pull request is ${s.state.toLowerCase()}`;
  if (s.mergeState !== "BEHIND") return `the branch is not behind ${s.base}`;
  return undefined;
}

/**
 * The user clicked "Update branch" on the card (issue #148, D47); the click is the approval. The
 * item stays where it is: GitHub or Dependabot updates the branch, and the next poll reads it.
 */
export function prBranchUpdated(item: WorkItem, ctx: Ctx, via: BranchUpdateVia): Transition {
  if (item.source !== "github-pr") throw new InvalidTransitionError("prBranchUpdated", item.state);
  const at = ctx.now();
  return {
    item: { ...item, updatedAt: at },
    events: [{ id: ctx.newId(), itemId: item.id, at, actor: "user", type: "pr.branch_updated", payload: { via } }],
  };
}

/** What the agent hears once its approved update-branch draft ran: go on with the review. */
export function branchUpdatedMessage(via: BranchUpdateVia, base: string): string {
  const how = via === "dependabot" ? `\`${DEPENDABOT_REBASE}\` was posted; Dependabot rebases the branch` : `GitHub merges \`${base}\` into the branch`;
  return (
    `The user approved your update-branch draft: ${how}. Do not wait for it; the changes of the pull request stay the same. ` +
    "Go on with your review and call draft_review once, at the end."
  );
}
