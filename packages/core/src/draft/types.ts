export type DraftType = "pr" | "push" | "comment";
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

export type Draft = PrDraft | PushDraft | CommentDraft;

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

/** The title a card shows for any draft. */
export function draftTitle(d: Draft): string {
  if (d.type === "pr") return (d.userEdits ?? d.payload).title;
  if (d.type === "comment") return repliesTitle(d.payload);
  const replies = d.payload.replies?.length ?? 0;
  return replies ? `${pushTitle(d.payload)}, reply ${replies} time${replies === 1 ? "" : "s"}` : pushTitle(d.payload);
}

/** The pull request the item's executed PR draft opened. Push drafts go to that same PR. */
export function executedPr(drafts: readonly Draft[]): PrDraftResult | undefined {
  return drafts.findLast((d): d is PrDraft => d.type === "pr" && d.state === "executed")?.result;
}
