import type { BranchUpdateVia } from "../pr/update-branch.js";

export type DraftType = "pr" | "push" | "comment" | "review" | "update_branch";
export type DraftState = "pending" | "approved" | "rejected" | "executed" | "failed";

export interface PrDraftPayload {
  title: string;
  body: string;
  base: string;
}

export interface PrDraftResult {
  url: string;
  number: number;
}

/** A commit the agent made on the item's branch that the PR does not have yet. */
export interface DraftCommit {
  sha: string;
  subject: string;
}

/**
 * Push the agent's new commits to the item's open PR (decision D35). The daemon fills in the PR
 * and the commits when the agent calls `draft_push`; `summary` is the agent's word on the fix.
 */
export interface PushDraftPayload {
  summary: string;
  number: number;
  url: string;
  branch: string;
  commits: DraftCommit[];
  /** Uncommitted changes the push commits first, as with a PR draft. */
  uncommitted: boolean;
  /** Answers to reviewers, posted after the push (D39). */
  replies?: DraftReply[];
}

/**
 * An answer to review feedback (D39). With `inReplyTo` it goes into that inline comment thread,
 * without it into the pull request's conversation.
 */
export interface DraftReply {
  body: string;
  inReplyTo?: number;
}

/** A reply that was posted: its index in the draft's `replies` and where it is. */
export interface PostedReply {
  index: number;
  url: string;
}

export interface PushDraftResult {
  /** The branch head after the push. */
  sha: string;
  posted?: PostedReply[];
}

/** Replies to review feedback without a code change (D39): `draft_comment`. */
export interface CommentDraftPayload {
  number: number;
  url: string;
  replies: DraftReply[];
}

/** Also kept while posting failed halfway, so a retry skips what is out. */
export interface CommentDraftResult {
  posted: PostedReply[];
}

/** The verdict of a review, as GitHub's API names it. */
export type ReviewVerdict = "COMMENT" | "REQUEST_CHANGES" | "APPROVE";

/** A comment on one line of the pull request's new version. */
export interface ReviewComment {
  path: string;
  line: number;
  body: string;
}

/**
 * A review of someone else's pull request (decision D43): `draft_review`. The daemon fills in the
 * PR and the commit the agent read; the user approves, the daemon posts it as the user.
 */
export interface ReviewDraftPayload {
  number: number;
  url: string;
  /** The head commit the agent reviewed; the comments' lines are of this commit. */
  commitId: string;
  verdict: ReviewVerdict;
  body: string;
  comments: ReviewComment[];
}

export interface ReviewDraftResult {
  id: number;
  url: string;
}

/**
 * Bring someone else's pull request up to date with its base (issue #148): `draft_update_branch`.
 * The daemon fills in the PR and how (`@dependabot rebase` or `gh pr update-branch`); the user
 * approves, the daemon asks as the user.
 */
export interface UpdateBranchDraftPayload {
  number: number;
  url: string;
  base: string;
  via: BranchUpdateVia;
  /** The agent's word on why, shown to the user. */
  reason: string;
}

export interface UpdateBranchDraftResult {
  via: BranchUpdateVia;
  /** The posted `@dependabot rebase` comment. */
  url?: string;
}

interface DraftBase {
  id: string;
  itemId: string;
  state: DraftState;
}

export interface PrDraft extends DraftBase {
  type: "pr";
  payload: PrDraftPayload;
  /** The payload after user edits. */
  userEdits?: PrDraftPayload;
  result?: PrDraftResult;
}

export interface PushDraft extends DraftBase {
  type: "push";
  payload: PushDraftPayload;
  result?: PushDraftResult;
}

export interface CommentDraft extends DraftBase {
  type: "comment";
  payload: CommentDraftPayload;
  result?: CommentDraftResult;
}

export interface ReviewDraft extends DraftBase {
  type: "review";
  payload: ReviewDraftPayload;
  result?: ReviewDraftResult;
}

export interface UpdateBranchDraft extends DraftBase {
  type: "update_branch";
  payload: UpdateBranchDraftPayload;
  result?: UpdateBranchDraftResult;
}

export type Draft = PrDraft | PushDraft | CommentDraft | ReviewDraft | UpdateBranchDraft;

const VERDICT_TITLE: Record<ReviewVerdict, string> = {
  APPROVE: "Approve",
  REQUEST_CHANGES: "Request changes on",
  COMMENT: "Comment on",
};

/** "Request changes on PR #12, 3 inline comments". */
export function reviewTitle(p: Pick<ReviewDraftPayload, "number" | "verdict" | "comments">): string {
  const n = p.comments.length;
  const head = `${VERDICT_TITLE[p.verdict]} PR #${p.number}`;
  return n ? `${head}, ${n} inline comment${n === 1 ? "" : "s"}` : head;
}

export function repliesTitle(p: Pick<CommentDraftPayload, "number" | "replies">): string {
  const n = p.replies.length;
  return `Reply ${n} time${n === 1 ? "" : "s"} on PR #${p.number}`;
}

/** "Push 2 commits to PR #45": what a card calls a push draft. */
export function pushTitle(p: Pick<PushDraftPayload, "commits" | "number" | "uncommitted">): string {
  // Uncommitted changes become one more commit when the push runs.
  const n = p.commits.length + (p.uncommitted ? 1 : 0);
  return `Push ${n} commit${n === 1 ? "" : "s"} to PR #${p.number}`;
}

/** "Update the branch of PR #85 (@dependabot rebase)". */
export function updateBranchTitle(p: Pick<UpdateBranchDraftPayload, "number" | "via">): string {
  return `Update the branch of PR #${p.number}${p.via === "dependabot" ? " (@dependabot rebase)" : ""}`;
}

/** The title a card shows for any draft. */
export function draftTitle(d: Draft): string {
  if (d.type === "pr") return (d.userEdits ?? d.payload).title;
  if (d.type === "update_branch") return updateBranchTitle(d.payload);
  if (d.type === "comment") return repliesTitle(d.payload);
  if (d.type === "review") return reviewTitle(d.payload);
  const replies = d.payload.replies?.length ?? 0;
  return replies ? `${pushTitle(d.payload)}, reply ${replies} time${replies === 1 ? "" : "s"}` : pushTitle(d.payload);
}

/** The pull request the item's executed PR draft opened. Push drafts go to that same PR. */
export function executedPr(drafts: readonly Draft[]): PrDraftResult | undefined {
  return drafts.findLast((d): d is PrDraft => d.type === "pr" && d.state === "executed")?.result;
}
