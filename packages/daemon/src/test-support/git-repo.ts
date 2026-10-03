import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdio: "pipe" }).toString();

/**
 * A clone at `<parent>/<owner>/<repo>` whose `origin` is a local bare repository holding one
 * commit on `main` with `files`. Real git, so fetch and worktree add run for real.
 */
export async function cloneWithOrigin(files: Record<string, string> = {}, parent?: string): Promise<{ clone: string; origin: string }> {
  const root = parent ?? (await mkdtemp(join(tmpdir(), "donepm-git-")));
  const seed = join(root, ".seed");
  const origin = join(root, ".origin.git");
  await mkdir(seed, { recursive: true });
  git(seed, "init", "-q", "-b", "main");
  await writeFile(join(seed, "README.md"), "hello\n");
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(seed, path)), { recursive: true });
    await writeFile(join(seed, path), content);
  }
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "init");
  git(root, "clone", "-q", "--bare", seed, origin);
  const clone = join(root, "acme", "widgets");
  git(root, "clone", "-q", origin, clone);
  return { clone, origin };
}

export { git };
