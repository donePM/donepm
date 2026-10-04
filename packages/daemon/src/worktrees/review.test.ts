import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Repo, WorkItem } from "@donepm/core";
import { describe, expect, it } from "vitest";
import { exec as realExec, type Exec } from "../process/exec.js";
import { fail, fakeExec, fixture, ok } from "../test-support/fake-exec.js";
import { cloneWithOrigin, git } from "../test-support/git-repo.js";
import { ensureReviewWorktree, reviewRef } from "./review.js";
import { WorktreeError } from "./create.js";

const item = (over: Partial<WorkItem> = {}): WorkItem => ({
  id: "i1", source: "github-pr", externalId: "acme/widgets#7", externalUrl: "https://github.com/acme/widgets/pull/7",
  title: "Add a widget", body: "", labels: [], state: "running", playbook: "review", priority: 1,
  stateSince: "", createdAt: "", updatedAt: "", ...over,
});

/** A clone whose origin has a `minor` branch and a pull request #7 into it (only under refs/pull). */
async function setup() {
  const { clone, origin } = await cloneWithOrigin();
  const seed = join(origin, "..", ".seed");
  git(seed, "checkout", "-q", "-b", "minor");
  await writeFile(join(seed, "minor.txt"), "base\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "minor");
  git(seed, "push", "-q", origin, "minor");
  git(seed, "checkout", "-q", "-b", "contributor");
  await writeFile(join(seed, "widget.ts"), "export const widget = 1;\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "add widget");
  git(seed, "push", "-q", origin, "contributor:refs/pull/7/head");
  const head = git(seed, "rev-parse", "HEAD").trim();
  const repo: Repo = { id: "r1", path: clone, originUrl: "github.com/acme/widgets", defaultBranch: "main" };
  const worktreeRoot = await mkdtemp(join(tmpdir(), "donepm-wt-"));
  return { repo, worktreeRoot, clone, head };
}

/** gh is faked from recorded output; git runs for real. */
function withGh(gh: Exec): Exec & { calls: { cmd: string; args: string[] }[] } {
  const calls: { cmd: string; args: string[] }[] = [];
  const fn = (async (cmd, args, opts) => {
    calls.push({ cmd, args });
    return cmd === "gh" ? gh(cmd, args, opts) : realExec(cmd, args, opts);
  }) as Exec & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}

describe("ensureReviewWorktree", () => {
  it("checks out the pull request's head on a review branch and reports its base (D41)", async () => {
    const { repo, worktreeRoot, clone, head } = await setup();
    const exec = withGh(fakeExec({ "gh pr view 7 --repo github.com/acme/widgets": ok(fixture("gh/pr-view-review.json")) }));
    const wt = await ensureReviewWorktree({ exec, item: item(), repo, worktreeRoot, branchPrefix: "dp/" });
    expect(wt).toEqual({
      branch: "dp/review-7-add-a-widget", baseBranch: "minor", created: true,
      path: join(worktreeRoot, "acme-widgets", "dp-review-7-add-a-widget"),
    });
    expect(execFileSync("git", ["-C", wt.path, "rev-parse", "HEAD"]).toString().trim()).toBe(head);
    expect(existsSync(join(wt.path, "widget.ts"))).toBe(true);
    // The base is fetched, so the playbook's `git diff origin/minor...HEAD` works.
    const diff = execFileSync("git", ["-C", wt.path, "diff", "--name-only", "origin/minor...HEAD"]).toString();
    expect(diff.trim()).toBe("widget.ts");
    expect(execFileSync("git", ["-C", clone, "rev-parse", reviewRef(7)]).toString().trim()).toBe(head);
  });

  it("reuses the item's worktree and keeps its base", async () => {
    const { repo, worktreeRoot } = await setup();
    const exec = withGh(fakeExec({ "gh pr view": ok(fixture("gh/pr-view-review.json")) }));
    const first = await ensureReviewWorktree({ exec, item: item(), repo, worktreeRoot, branchPrefix: "dp/" });
    exec.calls.length = 0;
    const again = await ensureReviewWorktree({
      exec, item: item({ worktreePath: first.path, branch: first.branch, baseBranch: "minor" }), repo, worktreeRoot, branchPrefix: "dp/",
    });
    expect(again).toEqual({ ...first, created: false });
    expect(exec.calls).toEqual([]);
  });

  it("refuses a pull request that is no longer open", async () => {
    const { repo, worktreeRoot } = await setup();
    const exec = withGh(fakeExec({ "gh pr view": ok(fixture("gh/pr-view-merged.json")) }));
    await expect(ensureReviewWorktree({ exec, item: item(), repo, worktreeRoot, branchPrefix: "dp/" })).rejects.toThrow(/is merged/);
  });

  it("fails with gh's message when gh cannot read the pull request", async () => {
    const { repo, worktreeRoot } = await setup();
    const exec = withGh(fakeExec({ "gh pr view": fail("GraphQL: Could not resolve to a PullRequest") }));
    const err = await ensureReviewWorktree({ exec, item: item(), repo, worktreeRoot, branchPrefix: "dp/" }).catch((e) => e);
    expect(err).toBeInstanceOf(WorktreeError);
    expect(err.output).toMatch(/Could not resolve/);
  });

  it("fails with git's output when the head cannot be fetched", async () => {
    const { repo, worktreeRoot } = await setup();
    const exec = withGh(fakeExec({ "gh pr view": ok(fixture("gh/pr-view-review.json")) }));
    const err = await ensureReviewWorktree({ exec, item: item({ externalId: "acme/widgets#8" }), repo, worktreeRoot, branchPrefix: "dp/" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(WorktreeError);
    expect(err.message).toMatch(/pull request #8/);
  });
});
