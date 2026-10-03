import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../db/database.js";
import { silentLog } from "../log.js";
import { exec } from "../process/exec.js";
import { testCtx } from "../test-support/ctx.js";
import { discoverRepos } from "./discover.js";
import { findGitRepos } from "./scan.js";
import { RepoStore } from "./store.js";

async function tree(): Promise<string> {
  return mkdtemp(join(tmpdir(), "donepm-scan-"));
}

async function gitDir(path: string): Promise<void> {
  await mkdir(join(path, ".git"), { recursive: true });
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

describe("findGitRepos", () => {
  it("finds clones up to depth 4 and not below", async () => {
    const root = await tree();
    await gitDir(join(root, "a"));
    await gitDir(join(root, "x", "y", "z", "d4"));
    await gitDir(join(root, "x", "y", "z", "w", "d5"));
    expect(await findGitRepos(root)).toEqual([join(root, "a"), join(root, "x", "y", "z", "d4")]);
  });

  it("skips node_modules, vendor and hidden folders", async () => {
    const root = await tree();
    await gitDir(join(root, "node_modules", "pkg"));
    await gitDir(join(root, "vendor", "lib"));
    await gitDir(join(root, ".cache", "repo"));
    await gitDir(join(root, "ok"));
    expect(await findGitRepos(root)).toEqual([join(root, "ok")]);
  });

  it("does not descend into a clone", async () => {
    const root = await tree();
    await gitDir(join(root, "outer"));
    await gitDir(join(root, "outer", "packages", "inner"));
    expect(await findGitRepos(root)).toEqual([join(root, "outer")]);
  });

  it("ignores .git files (worktrees, submodules) and symlinks", async () => {
    const root = await tree();
    await gitDir(join(root, "real"));
    await mkdir(join(root, "wt"));
    execFileSync("sh", ["-c", `echo 'gitdir: /x' > "${join(root, "wt", ".git")}"`]);
    await symlink(join(root, "real"), join(root, "link"));
    expect(await findGitRepos(root)).toEqual([join(root, "real")]);
  });

  it("returns nothing for a missing root", async () => {
    expect(await findGitRepos(join(tmpdir(), "donepm-does-not-exist"))).toEqual([]);
  });
});

describe("discoverRepos", () => {
  it("stores clones with normalised origin and default branch, and drops vanished ones", async () => {
    const root = await tree();
    const a = join(root, "a");
    const b = join(root, "org", "b");
    const noOrigin = join(root, "c");
    for (const p of [a, b, noOrigin]) {
      await mkdir(p, { recursive: true });
      git(p, "init", "-q");
    }
    git(a, "remote", "add", "origin", "git@github.com:Owner/A.git");
    git(a, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop");
    git(b, "remote", "add", "origin", "https://github.com/owner/b/");

    const repos = new RepoStore(openDb(":memory:"));
    const ctx = testCtx();
    const found = await discoverRepos({ root, exec, repos, ctx, log: silentLog });
    expect(found.map((r) => ({ path: r.path, originUrl: r.originUrl, defaultBranch: r.defaultBranch }))).toEqual([
      { path: a, originUrl: "github.com/owner/a", defaultBranch: "develop" },
      { path: b, originUrl: "github.com/owner/b", defaultBranch: "main" },
    ]);

    const idOfA = found[0]!.id;
    const again = await discoverRepos({ root: join(root, "a"), exec, repos, ctx, log: silentLog });
    expect(again.map((r) => r.id)).toEqual([idOfA]);
  });
});
