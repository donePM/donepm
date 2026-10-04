import type { Ctx } from "../ids.js";
import { InvalidTransitionError, type Transition } from "../item/transitions.js";
import type { WorkItem } from "../item/types.js";

/**
 * Where someone else's pull request stands on GitHub (D47), read on every poll. Values are GitHub's
 * own words; an unknown one is kept as it is.
 */
export interface PrStatus {
  /** `OPEN`, `CLOSED` or `MERGED`. Absent in statuses read before it was asked. */
  state?: string;
  /** When it was closed or merged. */
  closedAt?: string;
  /** `MERGEABLE`, `CONFLICTING`, or `UNKNOWN` while GitHub computes it. */
  mergeable: string;
  /** The branch it goes into. */
  base: string;
  /** `APPROVED`, `CHANGES_REQUESTED` or `REVIEW_REQUIRED`; absent without required reviews. */
  reviewDecision?: string;
  /** The user's own latest review: `APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`, … */
  viewerReview?: string;
  /** The checks of the head commit together: `SUCCESS`, `FAILURE`, `PENDING`, `ERROR`, `EXPECTED`. */
  checks?: string;
}

const same = (a: PrStatus | undefined, b: PrStatus): boolean =>
  a !== undefined &&
  a.state === b.state &&
  a.closedAt === b.closedAt &&
  a.mergeable === b.mergeable &&
  a.base === b.base &&
  a.reviewDecision === b.reviewDecision &&
  a.viewerReview === b.viewerReview &&
  a.checks === b.checks;

/** The item with the pull request's latest status; undefined when nothing changed. No event: it is display. */
export function withPrStatus(item: WorkItem, status: PrStatus, ctx: Ctx): WorkItem | undefined {
  if (item.source !== "github-pr" || same(item.prStatus, status)) return undefined;
  return { ...item, prStatus: { ...status }, updatedAt: ctx.now() };
}

/** The pull request conflicts with its base (D47): the card offers a comment to its author. */
export function prConflicts(item: Pick<WorkItem, "prStatus">): boolean {
  return item.prStatus?.mergeable === "CONFLICTING";
}

/**
 * What to ask the author of a conflicting pull request (D47). Dependabot rebases on a command; a
 * person is asked. The user edits it before it is posted.
 */
export function conflictComment(item: Pick<WorkItem, "author" | "prStatus">): string {
  if (item.author === "dependabot[bot]") return "@dependabot rebase";
  const base = item.prStatus?.base;
  return `This pull request has conflicts with \`${base ?? "its base branch"}\`. Could you resolve them?`;
}

/** The user posted a comment on someone else's pull request from the card (D47). The click is the approval. */
export function prCommented(item: WorkItem, ctx: Ctx, body: string): Transition {
  if (item.source !== "github-pr") throw new InvalidTransitionError("prCommented", item.state);
  const at = ctx.now();
  return {
    item: { ...item, updatedAt: at },
    events: [{ id: ctx.newId(), itemId: item.id, at, actor: "user", type: "pr.commented", payload: { body } }],
  };
}
