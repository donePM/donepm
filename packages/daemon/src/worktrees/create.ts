import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { branchName, slugify, workRef, type Repo, type WorkItem } from "@donepm/core";
import type { Exec } from "../process/exec.js";

export class WorktreeError extends Error {
  constructor(message: string, readonly output = "") {
    super(message);
    this.name = "WorktreeError";
  }
}

/** `owner/repo#123` → 123. */
export function issueNumber(externalId: string): number {
  const m = /#(\d+)$/.exec(externalId);
  if (!m) throw new WorktreeError(`cannot read an issue number from "${externalId}"`);
  return Number(m[1]);
}

/** What the item's branch is named by: `APP-123` for a ticket (issue #139), the number for an issue. */
export function branchRef(externalId: string): string {
  const ref = workRef(externalId);
  if (ref === undefined) throw new WorktreeError(`cannot read an issue number or ticket key from "${externalId}"`);
  return ref;
}

/** `<worktreeRoot>/<repo-slug>/<branch-slug>` (spec 7.1). */
export function worktreePath(worktreeRoot: string, repo: Pick<Repo, "originUrl">, branch: string): string {
  const repoSlug = slugify(repo.originUrl.split("/").slice(-2).join("/"));
  return join(worktreeRoot, repoSlug, slugify(branch));
}

async function localBranches(exec: Exec, repoPath: string): Promise<string[]> {
  const r = await exec("git", ["-C", repoPath, "for-each-ref", "--format=%(refname:short)", "refs/heads"]);
  if (r.code !== 0) throw new WorktreeError("git for-each-ref failed", r.stderr);
  return r.stdout.split("\n").filter(Boolean);
}

/**
 * Worktree for the item (spec 7.2). An existing `worktreePath` on disk is reused, so a restart
 * after `failed` continues where the agent stopped.
 */
export async function ensureWorktree(input: {
  exec: Exec;
  item: WorkItem;
  repo: Repo;
  worktreeRoot: string;
  branchPrefix: string;
}): Promise<{ path: string; branch: string; created: boolean }> {
  const { exec, item, repo } = input;
  if (item.worktreePath && item.branch && existsSync(item.worktreePath)) {
    return { path: item.worktreePath, branch: item.branch, created: false };
  }

  const fetch = await exec("git", ["-C", repo.path, "fetch", "origin", repo.defaultBranch], { timeoutMs: 5 * 60_000 });
  if (fetch.code !== 0) throw new WorktreeError(`git fetch origin ${repo.defaultBranch} failed`, fetch.stderr);

  const branch = branchName({
    prefix: input.branchPrefix,
    issueNumber: branchRef(item.externalId),
    title: item.title,
    existing: await localBranches(exec, repo.path),
  });
  const path = worktreePath(input.worktreeRoot, repo, branch);
  if (existsSync(path)) throw new WorktreeError(`${path} already exists and belongs to no item`);
  await mkdir(dirname(path), { recursive: true });

  const add = await exec("git", ["-C", repo.path, "worktree", "add", "-b", branch, "--", path, `origin/${repo.defaultBranch}`]);
  if (add.code !== 0) throw new WorktreeError("git worktree add failed", add.stderr);
  return { path, branch, created: true };
}
