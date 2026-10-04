import type { CheckLog, CiPr } from "@donepm/core";
import type { CiSource } from "../providers/ci-source.js";
import type { CodeHost } from "../providers/code-host.js";
import { providerRegistry, type Connection, type Providers } from "../providers/registry.js";
import type { Done } from "../providers/result.js";
import type { TicketRef, TicketSource } from "../providers/ticket-source.js";
import type { Exec } from "../process/exec.js";
import { withPriorityFields } from "./issue-fields.js";
import { assignIssueToMe, fetchAssignedIssues, fetchIssueState, fetchQueryIssues } from "./issues.js";
import { fetchFailedLogs, fetchPrChecks, rerunFailedRuns } from "./pr-checks.js";
import { createPr } from "./pr-create.js";
import { fetchPrFeedback } from "./pr-feedback.js";
import { mergePullRequest, updatePullRequestBranch } from "./pr-merge.js";
import { postReply } from "./pr-replies.js";
import { postReview } from "./pr-review.js";
import { prRepository, fetchPrState } from "./pr-state.js";
import { fetchPrStatuses } from "./pr-status.js";
import { fetchPullRequests } from "./pull-requests.js";
import { cloneRepo } from "./repo-clone.js";

export type GitHubAdapter = TicketSource & CodeHost & CiSource;

/** `owner/repo` and number of an `owner/repo#N` ticket. */
function split(ticket: TicketRef): [string, number] {
  const [repository, number] = ticket.externalId.split("#");
  return [repository!, Number(number)];
}

/**
 * GitHub through the user's `gh` (the `cli` backend, issue #138): every role GitHub has. `gh`
 * holds the credentials; the daemon runs it, never the agent.
 */
export function gitHubCliAdapter(exec: Exec): GitHubAdapter {
  return {
    collect: async (knownOrigins) => [
      { result: await fetchAssignedIssues(exec, knownOrigins) },
      { label: "review requests", result: await fetchPullRequests(exec, "--review-requested=@me") },
      { label: "assigned pull requests", result: await fetchPullRequests(exec, "--assignee=@me") },
    ],
    query: (origin, query) => fetchQueryIssues(exec, origin, query),
    withFields: (issues) => withPriorityFields(exec, issues),
    state: (ticket) => fetchIssueState(exec, ...split(ticket)),
    assignToMe: (ticket) => assignIssueToMe(exec, ...split(ticket)),

    clone: (origin, target) => cloneRepo(exec, origin, target),
    createPr: (input) => createPr(exec, input),
    prState: (pr) => fetchPrState(exec, pr),
    prStatuses: (refs) => fetchPrStatuses(exec, refs),
    prFeedback: (pr) => fetchPrFeedback(exec, pr),
    reply: (pr, reply) => postReply(exec, pr, reply),
    postReview: (review) => postReview(exec, review),
    merge: (pr, method) => mergePullRequest(exec, pr, method),
    updateBranch: (pr) => updatePullRequestBranch(exec, pr),

    checks: (pr) => fetchPrChecks(exec, pr),
    failedLogs: async (pr: CiPr, runs: readonly string[]): Promise<CheckLog[]> => {
      const repository = prRepository(pr.url);
      if (!repository) return [];
      return (await Promise.all(runs.map((run) => fetchFailedLogs(exec, repository, run)))).flat();
    },
    rerunFailed: async (pr: CiPr, runs: readonly string[]): Promise<Done> => {
      const repository = prRepository(pr.url);
      if (!repository) return { ok: false, error: `not a pull request URL: ${pr.url}` };
      return rerunFailedRuns(exec, repository, runs);
    },
  };
}

/** github.com through `gh`, the connection donePM has without a `connections` config. */
export function gitHubCliConnection(exec: Exec, host = "github.com", id = "github"): Connection {
  const adapter = gitHubCliAdapter(exec);
  return { id, kind: "github", backend: "cli", host, ticketSource: adapter, codeHost: adapter, ciSource: adapter };
}

export function githubProviders(exec: Exec): Providers {
  return providerRegistry([gitHubCliConnection(exec)]);
}
