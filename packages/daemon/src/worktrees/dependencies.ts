import { access, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { dependencyDirs, detectDependencies, installCommand, type DependencyPlan } from "@donepm/core";
import type { Exec } from "../process/exec.js";

export const INSTALL_TIMEOUT_MS = 30 * 60_000;

/** One dependencies step for the transcript (kind `system`, spec 7.3). */
export type DependenciesStep =
  | { type: "donepm_setup"; step: "dependencies"; manager: string; method: "clone"; dirs: string[]; ok: boolean; error?: string }
  | {
      type: "donepm_setup"; step: "dependencies"; manager: string; method: "install"; command: string;
      reason: string; ok: boolean; code: number; stdout: string; stderr: string;
    };

const exists = (path: string) => access(path).then(() => true, () => false);

async function sameFile(a: string, b: string): Promise<boolean> {
  try {
    const [x, y] = await Promise.all([readFile(a), readFile(b)]);
    return x.equals(y);
  } catch {
    return false;
  }
}

/** Copy-on-write clone of a directory tree: APFS `clonefile` on macOS, reflinks on Linux. */
function cloneArgs(platform: NodeJS.Platform, from: string, to: string): string[] | undefined {
  if (platform === "darwin") return ["-c", "-R", from, to];
  if (platform === "linux") return ["-R", "--reflink=auto", from, to];
  return undefined;
}

/**
 * The directories to fill in the worktree: gitignored (a committed `vendor/` stays as git left it)
 * and not there yet.
 */
async function missingDirs(exec: Exec, worktree: string, plan: DependencyPlan): Promise<string[]> {
  let packageJsons: string[] = [];
  if (plan.manager !== "composer") {
    const r = await exec("git", ["-C", worktree, "ls-files", "-z", "--", "*package.json"]);
    packageJsons = r.code === 0 ? r.stdout.split("\0").filter(Boolean) : [];
  }
  const dirs: string[] = [];
  for (const dir of dependencyDirs(plan.manager, packageJsons)) {
    if (await exists(join(worktree, dir))) continue;
    // Trailing slash: the directory does not exist yet, and `node_modules/` only matches directories.
    const ignored = await exec("git", ["-C", worktree, "check-ignore", "-q", "--", `${dir}/`]);
    if (ignored.code === 0) dirs.push(dir);
  }
  return dirs;
}

/**
 * Bring a new worktree its dependencies (spec 7.3, D34). Per package manager: when the main clone
 * has the same lockfile and its dependencies, clone them copy-on-write; otherwise the daemon runs
 * the install command in the worktree. Never symlinks: a worktree must not write into the main
 * clone's dependencies. Returns false when a manager's dependencies could not be provided.
 */
export async function provideDependencies(input: {
  exec: Exec;
  repoPath: string;
  worktree: string;
  report: (step: DependenciesStep) => void;
  platform?: NodeJS.Platform;
}): Promise<boolean> {
  const { exec, repoPath, worktree, report } = input;
  const platform = input.platform ?? process.platform;
  const plans = detectDependencies(await readdir(worktree).catch(() => []));

  for (const plan of plans) {
    const dirs = await missingDirs(exec, worktree, plan);
    if (dirs.length === 0) continue;

    const reason = await cloneBlocker(plan, dirs);
    if (!reason) {
      const cloned = await clone(dirs);
      if (cloned.ok) {
        report({ type: "donepm_setup", step: "dependencies", manager: plan.manager, method: "clone", dirs: cloned.dirs, ok: true });
        continue;
      }
      report({ type: "donepm_setup", step: "dependencies", manager: plan.manager, method: "clone", dirs: cloned.dirs, ok: false, error: cloned.error });
    }

    const command = installCommand(plan);
    const r = await exec(plan.install.cmd, plan.install.args, { cwd: worktree, timeoutMs: INSTALL_TIMEOUT_MS });
    const ok = r.code === 0;
    report({
      type: "donepm_setup", step: "dependencies", manager: plan.manager, method: "install", command,
      reason: reason ?? "copying from the main clone failed", ok, code: r.code, stdout: r.stdout, stderr: r.stderr,
    });
    if (!ok) return false;
  }
  return true;

  async function cloneBlocker(plan: DependencyPlan, dirs: string[]): Promise<string | undefined> {
    if (!cloneArgs(platform, "", "")) return `no copy-on-write on ${platform}`;
    if (!(await sameFile(join(repoPath, plan.lockfile), join(worktree, plan.lockfile)))) {
      return `${plan.lockfile} differs from the main clone`;
    }
    // The root directory decides: a workspace package without dependencies has none of its own.
    if (!(await exists(join(repoPath, dirs[0]!)))) return `the main clone has no ${dirs[0]}`;
    return undefined;
  }

  async function clone(dirs: string[]): Promise<{ ok: true; dirs: string[] } | { ok: false; dirs: string[]; error: string }> {
    const done: string[] = [];
    for (const dir of dirs) {
      const from = join(repoPath, dir);
      if (!(await exists(from))) continue;
      const r = await exec("cp", cloneArgs(platform, from, join(worktree, dir))!, { timeoutMs: INSTALL_TIMEOUT_MS });
      if (r.code !== 0) {
        // Leave nothing half copied for the install that follows.
        await Promise.all([...done, dir].map((d) => rm(join(worktree, d), { recursive: true, force: true })));
        return { ok: false, dirs: [...done, dir], error: r.stderr.trim() || `cp exited with ${r.code}` };
      }
      done.push(dir);
    }
    return { ok: true, dirs: done };
  }
}
