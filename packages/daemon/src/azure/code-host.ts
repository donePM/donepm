import { azureGitUrl, azurePrDescription, azurePrState, azurePrUrl, parseAzurePrUrl, parseCloneOrigin, type AzureRepo, type CiPr } from "@donepm/core";
import { z } from "zod";
import { parseJson } from "../gh/issues.js";
import type { CodeHost, PrCreated, PrState } from "../providers/code-host.js";
import type { Exec } from "../process/exec.js";
import { seg, type AzureTransport } from "./transport.js";

/** A clone can take minutes. */
const CLONE_TIMEOUT_MS = 30 * 60_000;

/** Lines of `git clone` stderr kept for the user. */
const STDERR_TAIL_LINES = 20;

const CreatedSchema = z.object({ pullRequestId: z.number().int().positive() });

const PullRequestSchema = z.object({
  status: z.string(),
  mergeStatus: z.string().optional(),
  closedDate: z.string().optional(),
  targetRefName: z.string().optional(),
});

/** What Azure DevOps does not do through donePM yet (issue #141): someone else's PRs and reviews. */
const NOT_YET = "not supported on Azure DevOps yet";

function repoPath(repo: AzureRepo): string {
  return `${seg(repo.project)}/_apis/git/repositories/${seg(repo.repository)}`;
}

/**
 * Azure Repos as a code host (issue #141): clone, open a pull request after the user approved its
 * draft, and watch where it stands. Review feedback and someone else's pull requests are not
 * read yet; merging and replying say so instead of acting.
 */
export function azureDevOpsCodeHost(exec: Exec, transport: AzureTransport): CodeHost {
  return {
    /**
     * `git clone` over HTTPS: git's credential helper (Git Credential Manager) has the user's
     * login. Never prompts; a missing login fails with git's reason.
     */
    async clone(origin, target) {
      const repo = parseCloneOrigin(origin)?.azure;
      if (!repo) return { ok: false, error: `${origin} is not dev.azure.com/organization/project/repository` };
      const r = await exec("git", ["clone", "--", azureGitUrl(repo), target], { timeoutMs: CLONE_TIMEOUT_MS, env: { GIT_TERMINAL_PROMPT: "0" } });
      if (r.code !== 0) return { ok: false, error: r.stderr.trimEnd().split("\n").slice(-STDERR_TAIL_LINES).join("\n").trim() || `git clone exited with ${r.code}` };
      return { ok: true };
    },

    async createPr(input): Promise<PrCreated> {
      const repo = parseCloneOrigin(input.origin)?.azure;
      if (!repo) return { ok: false, error: `${input.origin} is not an Azure DevOps repository` };
      const r = await transport({
        method: "POST",
        path: `${repoPath(repo)}/pullrequests`,
        body: {
          sourceRefName: `refs/heads/${input.head}`,
          targetRefName: `refs/heads/${input.base}`,
          title: input.title,
          description: azurePrDescription(input.body),
          ...(input.workItems?.length ? { workItemRefs: input.workItems.map((id) => ({ id: String(id) })) } : {}),
        },
      });
      if (!r.ok) return r;
      const parsed = parseJson(CreatedSchema, r.body);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      const number = parsed.value.pullRequestId;
      return { ok: true, pr: { url: azurePrUrl(repo, number), number } };
    },

    async prState(pr: CiPr): Promise<PrState> {
      const ref = parseAzurePrUrl(pr.url);
      if (!ref) return { ok: false, error: `not an Azure DevOps pull request URL: ${pr.url}` };
      const r = await transport({ method: "GET", path: `${repoPath(ref.repo)}/pullrequests/${ref.number}` });
      if (!r.ok) return r;
      const parsed = parseJson(PullRequestSchema, r.body);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      try {
        return { ok: true, ...azurePrState(parsed.value) };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },

    prStatuses: async () => new Map(),
    prFeedback: async () => ({ ok: true, entries: [] }),
    reply: async () => ({ ok: false, error: `replying is ${NOT_YET}` }),
    postReview: async () => ({ ok: false, error: `reviews are ${NOT_YET}` }),
    merge: async () => ({ ok: false, error: `merging is ${NOT_YET}` }),
    updateBranch: async () => ({ ok: false, error: `updating a branch is ${NOT_YET}` }),
  };
}
