import type { CiPr, MergeMethod } from "@donepm/core";
import type { Done } from "../providers/result.js";
import type { Exec } from "../process/exec.js";

const MERGE_TIMEOUT_MS = 2 * 60_000;
const UPDATE_TIMEOUT_MS = 2 * 60_000;

/** `host/owner/repo` of a pull request URL, for `--repo`. */
function repoOf(pr: CiPr): string | undefined {
  const u = new URL(pr.url);
  const [owner, name] = u.pathname.split("/").filter(Boolean);
  return owner && name && pr.number ? `${u.host}/${owner}/${name}` : undefined;
}

/**
 * `gh pr merge` as the user (D47). Someone else's branch is left alone: no `--delete-branch`, the
 * author (or Dependabot) decides about it.
 */
export async function mergePullRequest(exec: Exec, pr: CiPr, method: MergeMethod): Promise<Done> {
  const repo = repoOf(pr);
  if (!repo) return { ok: false, error: `not a pull request URL: ${pr.url}` };
  const r = await exec("gh", ["pr", "merge", String(pr.number), "--repo", repo, `--${method}`], { timeoutMs: MERGE_TIMEOUT_MS });
  if (r.code !== 0) return { ok: false, error: (r.stderr || r.stdout).trim() || `gh pr merge exited with ${r.code}` };
  return { ok: true };
}

/**
 * `gh pr update-branch`, GitHub's "Update branch" (#148): merges the base into someone else's pull
 * request as the user. Not `--rebase`: that rewrites the author's commits.
 */
export async function updatePullRequestBranch(exec: Exec, pr: CiPr): Promise<Done> {
  const repo = repoOf(pr);
  if (!repo) return { ok: false, error: `not a pull request URL: ${pr.url}` };
  const r = await exec("gh", ["pr", "update-branch", String(pr.number), "--repo", repo], { timeoutMs: UPDATE_TIMEOUT_MS });
  if (r.code !== 0) return { ok: false, error: (r.stderr || r.stdout).trim() || `gh pr update-branch exited with ${r.code}` };
  return { ok: true };
}
