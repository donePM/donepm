import type { Exec } from "../process/exec.js";
import { setupCopies } from "../worktrees/setup.js";

/** What the item's branch changes against its base, as the detail view and the draft card show it. */
export interface ItemDiff {
  /** The ref compared against, e.g. `origin/main`. */
  base: string;
  branch: string;
  /** Commits on the branch since it left the base. */
  commits: number;
  /**
   * Unified diff of the merge base against the working tree: committed and uncommitted changes,
   * plus untracked files as additions (spec §12.2). Untracked files that setup copied in (`.env`
   * and the like) are left out: approving never commits them (D25).
   */
  patch: string;
}

export class DiffError extends Error {
  constructor(message: string, readonly output = "") {
    super(message);
    this.name = "DiffError";
  }
}

/** Untracked files beyond this are left out; a stray build folder should not flood the view. */
const MAX_UNTRACKED = 100;

const DIFF_FLAGS = ["--no-color", "--no-ext-diff", "--find-renames"];

async function git(exec: Exec, cwd: string, args: string[], okCodes = [0]): Promise<string> {
  const r = await exec("git", args, { cwd });
  if (!okCodes.includes(r.code)) throw new DiffError(`git ${args[0]} failed`, r.stderr);
  return r.stdout;
}

/** `origin/<default>` when the clone has it (worktrees start there), else the local branch. */
async function baseRef(exec: Exec, cwd: string, defaultBranch: string): Promise<string> {
  const remote = `origin/${defaultBranch}`;
  const r = await exec("git", ["rev-parse", "--verify", "--quiet", `${remote}^{commit}`], { cwd });
  return r.code === 0 ? remote : defaultBranch;
}

export async function itemDiff(exec: Exec, input: { worktreePath: string; branch: string; defaultBranch: string }): Promise<ItemDiff> {
  const cwd = input.worktreePath;
  const base = await baseRef(exec, cwd, input.defaultBranch);
  const mergeBase = (await git(exec, cwd, ["merge-base", base, "HEAD"])).trim();
  const commits = Number((await git(exec, cwd, ["rev-list", "--count", `${mergeBase}..HEAD`])).trim());
  let patch = await git(exec, cwd, ["diff", ...DIFF_FLAGS, mergeBase, "--"]);

  const keepOut = (await setupCopies(cwd)).map((f) => `:(exclude,literal)${f}`);
  const untracked = (await git(exec, cwd, ["ls-files", "--others", "--exclude-standard", "-z", "--", ".", ...keepOut]))
    .split("\0")
    .filter(Boolean)
    .slice(0, MAX_UNTRACKED);
  for (const file of untracked) {
    // `--no-index` exits 1 when the files differ, which they always do here.
    patch += await git(exec, cwd, ["diff", ...DIFF_FLAGS, "--no-index", "--", "/dev/null", file], [0, 1]);
  }
  return { base, branch: input.branch, commits, patch };
}
