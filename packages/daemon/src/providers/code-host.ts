import type { CiPr, DraftReply, FeedbackEntry, MergeMethod, PrDraftResult, PrStatus, ReviewDraftPayload, ReviewDraftResult } from "@donepm/core";
import type { Done } from "./result.js";

/** Where a pull request donePM opened stands (spec 6.5, D36). */
export type PrState =
  | { ok: true; state: "OPEN" | "CLOSED" | "MERGED"; mergedAt: string | null; mergeable?: string; baseRefName?: string }
  | { ok: false; error: string };

/** A pull request by `owner/repo` and number, as an item's `externalId` names it. */
export interface PrRef {
  repository: string;
  number: number;
}

export type PrFeedbackResult = { ok: true; entries: FeedbackEntry[] } | { ok: false; error: string };
export type ReplyResult = { ok: true; url: string } | { ok: false; error: string };
export type ReviewResult = { ok: true; result: ReviewDraftResult } | { ok: false; error: string };
export type PrCreated = { ok: true; pr: PrDraftResult } | { ok: false; error: string };

/** An approved PR draft, once its branch is pushed. */
export interface PrCreate {
  /** Normalised origin, `host/owner/repo`. */
  origin: string;
  head: string;
  base: string;
  title: string;
  body: string;
  /** The item's worktree. */
  cwd: string;
}

/**
 * Where the code lives (issue #138): clone, pull requests and their reviews. Every method that
 * writes runs as the user, only after the user's approval or click, and never from the agent.
 */
export interface CodeHost {
  /** Clone `origin` (`host/owner/repo`) into `target`. */
  clone(origin: string, target: string): Promise<Done>;
  createPr(input: PrCreate): Promise<PrCreated>;
  prState(pr: CiPr): Promise<PrState>;
  /** Someone else's pull requests (D47), keyed by item `externalId` (`owner/repo#N`, `host/owner/repo#N` off github.com, #140); a missing key could not be read. */
  prStatuses(refs: readonly PrRef[]): Promise<Map<string, PrStatus>>;
  /** Review feedback on a pull request donePM opened (D39), oldest first. */
  prFeedback(pr: CiPr): Promise<PrFeedbackResult>;
  /** A reply in an inline thread (`inReplyTo`) or a comment in the conversation (D39). */
  reply(pr: CiPr, reply: DraftReply): Promise<ReplyResult>;
  /** A review of someone else's pull request (D43). */
  postReview(review: ReviewDraftPayload): Promise<ReviewResult>;
  /** Merge someone else's pull request; their branch is left alone (D47). */
  merge(pr: CiPr, method: MergeMethod): Promise<Done>;
  /** Bring someone else's pull request up to date with its base by merging the base in (#148). */
  updateBranch(pr: CiPr): Promise<Done>;
}
