import { failedRuns, GITHUB_COM, isAzureRun, parseExternalId, type CheckLog, type CiPr, type FailedCheck } from "@donepm/core";
import type { CiSource } from "../providers/ci-source.js";
import type { CodeHost } from "../providers/code-host.js";
import { providerRegistry, type Connection, type Providers } from "../providers/registry.js";
import type { Done } from "../providers/result.js";
import type { TicketRef, TicketSource } from "../providers/ticket-source.js";
import type { Exec } from "../process/exec.js";
import { onHost } from "./hosts.js";
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

/** The `--repo` value and number of an `owner/repo#N` or `host/owner/repo#N` ticket (issue #140). */
function split(ticket: TicketRef): [string, number] {
  const ref = parseExternalId(ticket.externalId);
  if (!ref) throw new Error(`not an issue id: ${ticket.externalId}`);
  return [ref.repo, ref.number];
}

/**
 * GitHub through the user's `gh` (the `cli` backend, issue #138): every role GitHub has. `gh`
 * holds the credentials; the daemon runs it, never the agent. One adapter per GitHub host
 * (issue #140): its searches and batched reads go to that host, and every other call names the
 * host in its `--repo` or URL.
 */
export function gitHubCliAdapter(exec: Exec, host = GITHUB_COM): GitHubAdapter {
  return {
    collect: async (knownOrigins) => [
      { result: await fetchAssignedIssues(exec, () => knownOrigins().filter((origin) => onHost(origin, [host])), host) },
      { label: "review requests", result: await fetchPullRequests(exec, "--review-requested=@me", host) },
      { label: "assigned pull requests", result: await fetchPullRequests(exec, "--assignee=@me", host) },
    ],
    query: (origin, query) => fetchQueryIssues(exec, origin, query),
    withFields: (issues) => withPriorityFields(exec, issues),
    state: (ticket) => fetchIssueState(exec, ...split(ticket)),
    assignToMe: (ticket) => assignIssueToMe(exec, ...split(ticket)),

    clone: (origin, target) => cloneRepo(exec, origin, target),
    createPr: (input) => createPr(exec, input),
    prState: (pr) => fetchPrState(exec, pr),
    prStatuses: (refs) => fetchPrStatuses(exec, refs, host),
    prFeedback: (pr) => fetchPrFeedback(exec, pr),
    reply: (pr, reply) => postReply(exec, pr, reply),
    postReview: (review) => postReview(exec, review),
    merge: (pr, method) => mergePullRequest(exec, pr, method),
    updateBranch: (pr) => updatePullRequestBranch(exec, pr),

    checks: (pr) => fetchPrChecks(exec, pr),
    // The GitHub Actions runs of the failed checks; checks of other CI have none here.
    failedLogs: async (pr: CiPr, failed: readonly FailedCheck[]): Promise<CheckLog[]> => {
      const repository = prRepository(pr.url);
      if (!repository) return [];
      const names = new Set(failed.map((c) => c.name));
      const runs = failedRuns(failed).filter((run) => !isAzureRun(run));
      return (await Promise.all(runs.map((run) => fetchFailedLogs(exec, repository, run)))).flat().filter((l) => names.has(l.name));
    },
    rerunFailed: async (pr: CiPr, runs: readonly string[]): Promise<Done> => {
      const repository = prRepository(pr.url);
      if (!repository) return { ok: false, error: `not a pull request URL: ${pr.url}` };
      return rerunFailedRuns(exec, repository, runs);
    },
  };
}

/**
 * A GitHub host through `gh`: github.com is the connection donePM has without a `connections`
 * config; a GitHub Enterprise host is one more with its own `host` and `id` (issue #140).
 */
export function gitHubCliConnection(exec: Exec, host = GITHUB_COM, id = "github"): Connection {
  const adapter = gitHubCliAdapter(exec, host);
  return { id, kind: "github", backend: "cli", host, ticketSource: adapter, codeHost: adapter, ciSource: adapter };
}

export function githubProviders(exec: Exec): Providers {
  return providerRegistry([gitHubCliConnection(exec)]);
}
