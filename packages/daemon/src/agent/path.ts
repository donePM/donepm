import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, symlink } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { BLOCKED_COMMANDS } from "./argv.js";

/**
 * `PATH` for the agent without `gh`, `glab` and `jira` (spec 9.1).
 *
 * A directory holding one of them is not dropped outright: on macOS that is usually
 * `/opt/homebrew/bin`, which also holds `node`, `pnpm` and everything else the agent needs to run
 * tests. It is replaced by a filtered copy under `shimRoot`: a directory of symlinks to every entry
 * except the blocked ones. Directories without a blocked command are kept as they are.
 */
export async function filteredPath(path: string, shimRoot: string): Promise<string> {
  const out: string[] = [];
  for (const dir of path.split(delimiter).filter(Boolean)) {
    if (!BLOCKED_COMMANDS.some((c) => existsSync(join(dir, c)))) {
      out.push(dir);
      continue;
    }
    out.push(await filteredCopy(dir, shimRoot));
  }
  return out.join(delimiter);
}

async function filteredCopy(dir: string, shimRoot: string): Promise<string> {
  const target = join(shimRoot, createHash("sha256").update(dir).digest("hex").slice(0, 16));
  // Rebuilt every time, so tools installed since the last start are found.
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return target;
  }
  const blocked = new Set<string>(BLOCKED_COMMANDS);
  for (const name of entries) {
    if (blocked.has(name)) continue;
    await symlink(join(dir, name), join(target, name));
  }
  return target;
}
