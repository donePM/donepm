import type { ReviewVerdict } from "@donepm/core";

/** How the board and the review draft name a verdict (D43). */
export const VERDICT_LABEL: Record<ReviewVerdict, string> = {
  APPROVE: "Approve",
  REQUEST_CHANGES: "Request changes",
  COMMENT: "Comment",
};
