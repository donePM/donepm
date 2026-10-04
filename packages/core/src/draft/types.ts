export type DraftType = "pr" | "push";
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
}

export interface PushDraftResult {
  /** The branch head after the push. */
  sha: string;
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

export type Draft = PrDraft | PushDraft;

/** "Push 2 commits to PR #45": what a card calls a push draft. */
export function pushTitle(p: Pick<PushDraftPayload, "commits" | "number" | "uncommitted">): string {
  // Uncommitted changes become one more commit when the push runs.
  const n = p.commits.length + (p.uncommitted ? 1 : 0);
  return `Push ${n} commit${n === 1 ? "" : "s"} to PR #${p.number}`;
}

/** The title a card shows for any draft. */
export function draftTitle(d: Draft): string {
  return d.type === "pr" ? (d.userEdits ?? d.payload).title : pushTitle(d.payload);
}

/** The pull request the item's executed PR draft opened. Push drafts go to that same PR. */
export function executedPr(drafts: readonly Draft[]): PrDraftResult | undefined {
  return drafts.findLast((d): d is PrDraft => d.type === "pr" && d.state === "executed")?.result;
}
