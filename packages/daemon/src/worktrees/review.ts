import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { branchName, type Repo, type WorkItem } from "@donepm/core";
import { fetchPrState } from "../gh/pr-state.js";
import type { Exec } from "../process/exec.js";
import { issueNumber, worktreePath, WorktreeError } from "./create.js";

/** Where the daemon keeps a reviewed pull request's head: outside branches and remote branches. */
export function reviewRef(number: number): string {
  return `refs/donepm/pull/${number}`;
}

/**
 * Worktree for reviewing someone else's pull request (D41). The daemon asks `gh` for the base
 * branch, fetches it and the PR's head through `refs/pull/<n>/head` (which works for forks, too),
 * and checks the head out on a new local branch `<prefix>review-<n>-<slug>`. Nothing runs in it:
 * no setup, no dependency install. An existing worktree is reused, like `ensureWorktree`.
 */
export async function ensureReviewWorktree(input: {
  exec: Exec;
  item: WorkItem;
  repo: Repo;
  worktreeRoot: string;
  branchPrefix: string;
}): Promise<{ path: string; branch: string; baseBranch: string; created: boolean }> {
  const { exec, item, repo } = input;
  if (item.worktreePath && item.branch && existsSync(item.worktreePath)) {
    return { path: item.worktreePath, branch: item.branch, baseBranch: item.baseBranch ?? repo.defaultBranch, created: false };
  }

  const number = issueNumber(item.externalId);
  const pr = await fetchPrState(exec, { number, url: item.externalUrl });
  if (!pr.ok) throw new WorktreeError(`gh pr view ${number} failed`, pr.error);
  if (pr.state !== "OPEN") throw new WorktreeError(`pull request #${number} is ${pr.state.toLowerCase()}`);
  const baseBranch = pr.baseRefName ?? repo.defaultBranch;

  const ref = reviewRef(number);
  const fetch = await exec("git", ["-C", repo.path, "fetch", "origin", baseBranch, `+refs/pull/${number}/head:${ref}`], {
    timeoutMs: 5 * 60_000,
  });
  if (fetch.code !== 0) throw new WorktreeError(`git fetch of pull request #${number} failed`, fetch.stderr);

  const branches = await exec("git", ["-C", repo.path, "for-each-ref", "--format=%(refname:short)", "refs/heads"]);
  if (branches.code !== 0) throw new WorktreeError("git for-each-ref failed", branches.stderr);
  const branch = branchName({
    prefix: `${input.branchPrefix}review-`,
    issueNumber: number,
    title: item.title,
    existing: branches.stdout.split("\n").filter(Boolean),
  });
  const path = worktreePath(input.worktreeRoot, repo, branch);
  if (existsSync(path)) throw new WorktreeError(`${path} already exists and belongs to no item`);
  await mkdir(dirname(path), { recursive: true });

  const add = await exec("git", ["-C", repo.path, "worktree", "add", "-b", branch, "--", path, ref]);
  if (add.code !== 0) throw new WorktreeError("git worktree add failed", add.stderr);
  return { path, branch, baseBranch, created: true };
}
