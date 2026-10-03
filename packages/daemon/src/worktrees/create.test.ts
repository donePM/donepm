import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Repo, WorkItem } from "@donepm/core";
import { describe, expect, it } from "vitest";
import { exec } from "../process/exec.js";
import { cloneWithOrigin } from "../test-support/git-repo.js";
import { ensureWorktree, issueNumber, worktreePath, WorktreeError } from "./create.js";

const item = (over: Partial<WorkItem> = {}): WorkItem => ({
  id: "i1", source: "github-issue", externalId: "acme/widgets#42", externalUrl: "", title: "Fix the Übel",
  body: "", labels: [], state: "running", playbook: "implement", priority: 1,
  createdAt: "", updatedAt: "", ...over,
});

async function setup() {
  const { clone } = await cloneWithOrigin();
  const repo: Repo = { id: "r1", path: clone, originUrl: "github.com/acme/widgets", defaultBranch: "main" };
  const worktreeRoot = await mkdtemp(join(tmpdir(), "donepm-wt-"));
  return { repo, worktreeRoot, clone };
}

describe("worktree naming", () => {
  it("reads the issue number", () => {
    expect(issueNumber("acme/widgets#42")).toBe(42);
    expect(() => issueNumber("acme/widgets")).toThrow(WorktreeError);
  });

  it("puts the worktree under repo and branch slugs", () => {
    expect(worktreePath("/wt", { originUrl: "github.com/Acme/Widgets" }, "dp/42-fix")).toBe("/wt/acme-widgets/dp-42-fix");
  });
});

describe("ensureWorktree", () => {
  it("fetches and adds a worktree on a new branch from origin/<default>", async () => {
    const { repo, worktreeRoot, clone } = await setup();
    const wt = await ensureWorktree({ exec, item: item(), repo, worktreeRoot, branchPrefix: "dp/" });
    expect(wt).toEqual({ branch: "dp/42-fix-the-uebel", path: join(worktreeRoot, "acme-widgets", "dp-42-fix-the-uebel"), created: true });
    expect(existsSync(join(wt.path, "README.md"))).toBe(true);
    const head = execFileSync("git", ["-C", wt.path, "rev-parse", "--abbrev-ref", "HEAD"]).toString().trim();
    expect(head).toBe("dp/42-fix-the-uebel");
    expect(execFileSync("git", ["-C", clone, "branch", "--list"]).toString()).toContain("dp/42-fix-the-uebel");
  });

  it("picks a free branch name when the branch exists", async () => {
    const { repo, worktreeRoot, clone } = await setup();
    execFileSync("git", ["-C", clone, "branch", "dp/42-fix-the-uebel"]);
    const wt = await ensureWorktree({ exec, item: item(), repo, worktreeRoot, branchPrefix: "dp/" });
    expect(wt.branch).toBe("dp/42-fix-the-uebel-2");
  });

  it("reuses the item's worktree when it is still on disk", async () => {
    const { repo, worktreeRoot } = await setup();
    const first = await ensureWorktree({ exec, item: item(), repo, worktreeRoot, branchPrefix: "dp/" });
    const again = await ensureWorktree({
      exec, item: item({ worktreePath: first.path, branch: first.branch }), repo, worktreeRoot, branchPrefix: "dp/",
    });
    expect(again).toEqual({ ...first, created: false });
  });

  it("fails with git's output when fetch fails", async () => {
    const { repo, worktreeRoot } = await setup();
    const err = await ensureWorktree({ exec, item: item(), repo: { ...repo, defaultBranch: "nope" }, worktreeRoot, branchPrefix: "dp/" }).catch((e) => e);
    expect(err).toBeInstanceOf(WorktreeError);
    expect(err.message).toMatch(/fetch origin nope/);
    expect(err.output).toMatch(/nope/);
  });

  it("refuses a target directory that already exists", async () => {
    const { repo, worktreeRoot } = await setup();
    await mkdir(join(worktreeRoot, "acme-widgets", "dp-42-fix-the-uebel"), { recursive: true });
    await expect(ensureWorktree({ exec, item: item(), repo, worktreeRoot, branchPrefix: "dp/" })).rejects.toThrow(/already exists/);
  });
});
