import type { PrStatus } from "@donepm/core";

export type ChipTone = "ok" | "bad" | "wait" | "plain";

export interface Chip {
  text: string;
  tone: ChipTone;
  title: string;
}

const CHECKS: Record<string, Omit<Chip, "title">> = {
  SUCCESS: { text: "CI green", tone: "ok" },
  FAILURE: { text: "CI failed", tone: "bad" },
  ERROR: { text: "CI failed", tone: "bad" },
  PENDING: { text: "CI running", tone: "wait" },
  EXPECTED: { text: "CI running", tone: "wait" },
};

const REVIEWS: Record<string, Omit<Chip, "title">> = {
  APPROVED: { text: "You approved", tone: "ok" },
  CHANGES_REQUESTED: { text: "You asked for changes", tone: "wait" },
  COMMENTED: { text: "You commented", tone: "plain" },
};

/**
 * Where someone else's pull request stands, as chips on its card (D47): conflicts or a branch behind its base, the checks of its
 * head commit, the user's own review. An unknown GitHub value is shown as GitHub writes it.
 */
export function prStatusChips(status: PrStatus | undefined): Chip[] {
  if (!status) return [];
  const chips: Chip[] = [];
  if (status.mergeable === "CONFLICTING") chips.push({ text: "Conflicts", tone: "bad", title: `Conflicts with ${status.base}` });
  else if (status.mergeState === "BEHIND") chips.push({ text: `Behind ${status.base}`, tone: "wait", title: `The branch is behind ${status.base}; waiting for it to be updated` });
  if (status.checks) {
    const c = CHECKS[status.checks] ?? { text: `CI ${status.checks.toLowerCase()}`, tone: "plain" };
    chips.push({ ...c, title: `Checks of the head commit: ${status.checks}` });
  }
  const review = status.viewerReview ? (REVIEWS[status.viewerReview] ?? { text: `You: ${status.viewerReview.toLowerCase()}`, tone: "plain" }) : { text: "Not reviewed by you", tone: "plain" as const };
  chips.push({ ...review, title: status.reviewDecision ? `Review decision: ${status.reviewDecision}` : "Your latest review" });
  return chips;
}
