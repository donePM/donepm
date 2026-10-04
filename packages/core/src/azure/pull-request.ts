/** The fields of an Azure DevOps `GitPullRequest` that say where it stands (issue #141). */
export interface AzurePullRequest {
  /** `active`, `completed` or `abandoned`. */
  status: string;
  /** `succeeded`, `conflicts`, `queued`, `rejectedByPolicy`, `failure` or `notSet`. */
  mergeStatus?: string | undefined;
  closedDate?: string | undefined;
  /** `refs/heads/main`. */
  targetRefName?: string | undefined;
}

/** An Azure DevOps pull request in the terms donePM watches GitHub's in (spec 6.5, D36). */
export interface AzurePrState {
  state: "OPEN" | "CLOSED" | "MERGED";
  mergedAt: string | null;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  baseRefName?: string;
}

const STATES: Record<string, AzurePrState["state"]> = { active: "OPEN", completed: "MERGED", abandoned: "CLOSED" };

/**
 * `active` is open, `completed` merged, `abandoned` closed; a `conflicts` merge status is a
 * conflict with the base, `succeeded` mergeable, anything else not known yet. Throws on a status
 * it does not know, so the caller reports it instead of guessing.
 */
export function azurePrState(pr: AzurePullRequest): AzurePrState {
  const state = STATES[pr.status];
  if (!state) throw new Error(`unknown pull request status: ${pr.status}`);
  const mergeable = pr.mergeStatus === "conflicts" ? "CONFLICTING" : pr.mergeStatus === "succeeded" ? "MERGEABLE" : "UNKNOWN";
  const base = pr.targetRefName?.replace(/^refs\/heads\//, "");
  return {
    state,
    mergedAt: state === "MERGED" ? (pr.closedDate ?? null) : null,
    mergeable,
    ...(base ? { baseRefName: base } : {}),
  };
}

/** Azure Repos refuses a pull request description longer than this. */
export const AZURE_PR_DESCRIPTION_MAX = 4000;

const TRUNCATED = "\n\n…(shortened to fit Azure DevOps' 4000 character limit)";

/** The description as Azure Repos takes it: cut to its limit, with a note that it was. */
export function azurePrDescription(body: string): string {
  if (body.length <= AZURE_PR_DESCRIPTION_MAX) return body;
  return body.slice(0, AZURE_PR_DESCRIPTION_MAX - TRUNCATED.length) + TRUNCATED;
}
