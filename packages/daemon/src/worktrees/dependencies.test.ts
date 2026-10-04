import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exec as realExec, type Exec } from "../process/exec.js";
import { cloneWithOrigin, git } from "../test-support/git-repo.js";
import { provideDependencies, type DependenciesStep } from "./dependencies.js";

const LOCK = "lockfileVersion: '9.0'\n";

/** A pnpm workspace clone with installed dependencies, and a fresh worktree of it. */
async function workspace(files: Record<string, string> = {}) {
  const { clone } = await cloneWithOrigin({
    ".gitignore": "node_modules/\n",
    "package.json": "{}",
    "pnpm-lock.yaml": LOCK,
    "packages/web/package.json": "{}",
    ...files,
  });
  await mkdir(join(clone, "node_modules", "vitest"), { recursive: true });
  await writeFile(join(clone, "node_modules", "vitest", "index.js"), "root");
  await mkdir(join(clone, "packages", "web", "node_modules", "vue"), { recursive: true });
  await writeFile(join(clone, "packages", "web", "node_modules", "vue", "index.js"), "web");
  const worktree = join(clone, "..", "wt");
  git(clone, "worktree", "add", "-q", "-b", "dp/1-x", worktree);

  const installs: string[] = [];
  // Real git and cp; package managers are recorded, never run.
  const exec: Exec = async (cmd, args, opts) => {
    if (cmd === "git" || cmd === "cp") return realExec(cmd, args, opts);
    installs.push(`${cmd} ${args.join(" ")} @ ${opts?.cwd}`);
    return { code: 0, stdout: "installed", stderr: "" };
  };
  const steps: DependenciesStep[] = [];
  const run = (platform?: NodeJS.Platform) =>
    provideDependencies({ exec, repoPath: clone, worktree, report: (s) => steps.push(s), ...(platform ? { platform } : {}) });
  return { clone, worktree, installs, steps, run };
}

describe("provideDependencies", () => {
  it("copies every node_modules of the workspace from the main clone when the lockfile matches", async () => {
    const w = await workspace();
    expect(await w.run()).toBe(true);
    expect(w.installs).toEqual([]);
    expect(w.steps).toEqual([
      { type: "donepm_setup", step: "dependencies", manager: "pnpm", method: "clone", dirs: ["node_modules", "packages/web/node_modules"], ok: true },
    ]);
    expect(await readFile(join(w.worktree, "node_modules", "vitest", "index.js"), "utf8")).toBe("root");
    expect(await readFile(join(w.worktree, "packages", "web", "node_modules", "vue", "index.js"), "utf8")).toBe("web");
    // A copy, not a link into the main clone.
    expect((await lstat(join(w.worktree, "node_modules"))).isSymbolicLink()).toBe(false);
  });

  it("installs when the worktree's lockfile differs from the main clone", async () => {
    const w = await workspace();
    await writeFile(join(w.clone, "pnpm-lock.yaml"), `${LOCK}# changed\n`);
    expect(await w.run()).toBe(true);
    expect(w.installs).toEqual([`pnpm install --frozen-lockfile @ ${w.worktree}`]);
    expect(w.steps).toEqual([
      expect.objectContaining({ method: "install", command: "pnpm install --frozen-lockfile", reason: "pnpm-lock.yaml differs from the main clone", ok: true }),
    ]);
  });

  it("installs when the main clone has no dependencies", async () => {
    const { clone } = await cloneWithOrigin({ ".gitignore": "vendor/\n", "composer.lock": "{}" });
    const worktree = join(clone, "..", "wt");
    git(clone, "worktree", "add", "-q", "-b", "dp/1-x", worktree);
    const calls: string[] = [];
    const exec: Exec = async (cmd, args, opts) =>
      cmd === "git" ? realExec(cmd, args, opts) : (calls.push(`${cmd} ${args.join(" ")}`), { code: 0, stdout: "", stderr: "" });
    const steps: DependenciesStep[] = [];
    expect(await provideDependencies({ exec, repoPath: clone, worktree, report: (s) => steps.push(s) })).toBe(true);
    expect(calls).toEqual(["composer install --no-interaction"]);
    expect(steps[0]).toMatchObject({ manager: "composer", method: "install", reason: "the main clone has no vendor" });
  });

  it("installs where there is no copy-on-write", async () => {
    const w = await workspace();
    expect(await w.run("win32")).toBe(true);
    expect(w.steps[0]).toMatchObject({ method: "install", reason: "no copy-on-write on win32" });
  });

  it("reports a failed install and stops", async () => {
    const w = await workspace();
    await writeFile(join(w.clone, "pnpm-lock.yaml"), "other");
    const steps: DependenciesStep[] = [];
    const exec: Exec = async (cmd, args, opts) =>
      cmd === "git" ? realExec(cmd, args, opts) : { code: 1, stdout: "", stderr: "ERR_PNPM_OUTDATED_LOCKFILE" };
    expect(await provideDependencies({ exec, repoPath: w.clone, worktree: w.worktree, report: (s) => steps.push(s) })).toBe(false);
    expect(steps).toEqual([expect.objectContaining({ method: "install", ok: false, code: 1, stderr: "ERR_PNPM_OUTDATED_LOCKFILE" })]);
  });

  it("leaves a committed vendor directory alone", async () => {
    const { clone } = await cloneWithOrigin({ "composer.lock": "{}", "vendor/autoload.php": "<?php" });
    const worktree = join(clone, "..", "wt");
    git(clone, "worktree", "add", "-q", "-b", "dp/1-x", worktree);
    const steps: DependenciesStep[] = [];
    expect(await provideDependencies({ exec: realExec, repoPath: clone, worktree, report: (s) => steps.push(s) })).toBe(true);
    expect(steps).toEqual([]);
  });

  it("does nothing without a lockfile", async () => {
    const { clone } = await cloneWithOrigin({ "package.json": "{}" });
    const steps: DependenciesStep[] = [];
    expect(await provideDependencies({ exec: realExec, repoPath: clone, worktree: clone, report: (s) => steps.push(s) })).toBe(true);
    expect(steps).toEqual([]);
  });
});
