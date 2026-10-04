import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseRepoSetup, type RepoSetup } from "@donepm/core";
import type { Exec } from "../process/exec.js";
import { provideDependencies, type DependenciesStep } from "./dependencies.js";

export const SETUP_FILE = ".donepm/setup.yml";
export const SETUP_STEP_TIMEOUT_MS = 30 * 60_000;

/** One line of setup output for the transcript (kind `system`). */
export type SetupStep =
  | { type: "donepm_setup"; step: "copy"; file: string; ok: boolean; error?: string }
  | { type: "donepm_setup"; step: "run"; command: string; ok: boolean; code: number; stdout: string; stderr: string }
  | { type: "donepm_setup"; step: "config"; ok: false; error: string }
  | DependenciesStep;

async function readSetup(worktree: string): Promise<RepoSetup | undefined> {
  let source: string;
  try {
    source = await readFile(join(worktree, SETUP_FILE), "utf8");
  } catch {
    return undefined;
  }
  return parseRepoSetup(source);
}

/**
 * Files setup copied into the worktree from the main clone, usually secrets such as `.env`. They
 * are never committed by the daemon. Empty when there is no (valid) setup file.
 */
export async function setupCopies(worktree: string): Promise<string[]> {
  try {
    return (await readSetup(worktree))?.copy ?? [];
  } catch {
    return [];
  }
}

/**
 * Set up a new worktree (spec 7.3): dependencies (D34, unless `.donepm/setup.yml` says
 * `dependencies: off`), then the setup file's `copy` from the main clone and `run` in the worktree,
 * in order. Stops at the first failure. Returns false when setup failed.
 */
export async function runSetup(input: {
  exec: Exec;
  repoPath: string;
  worktree: string;
  report: (step: SetupStep) => void;
}): Promise<boolean> {
  let setup: RepoSetup | undefined;
  try {
    setup = await readSetup(input.worktree);
  } catch (e) {
    input.report({ type: "donepm_setup", step: "config", ok: false, error: (e as Error).message });
    return false;
  }
  if (setup?.dependencies !== "off") {
    if (!(await provideDependencies(input))) return false;
  }
  if (!setup) return true;

  for (const file of setup.copy ?? []) {
    try {
      const to = join(input.worktree, file);
      await mkdir(dirname(to), { recursive: true });
      await copyFile(join(input.repoPath, file), to);
      input.report({ type: "donepm_setup", step: "copy", file, ok: true });
    } catch (e) {
      input.report({ type: "donepm_setup", step: "copy", file, ok: false, error: (e as Error).message });
      return false;
    }
  }

  for (const command of setup.run ?? []) {
    const r = await input.exec("sh", ["-c", command], { cwd: input.worktree, timeoutMs: SETUP_STEP_TIMEOUT_MS });
    const ok = r.code === 0;
    input.report({ type: "donepm_setup", step: "run", command, ok, code: r.code, stdout: r.stdout, stderr: r.stderr });
    if (!ok) return false;
  }
  return true;
}
