import { readdir } from "node:fs/promises";
import { join } from "node:path";

export const MAX_SCAN_DEPTH = 4;
const SKIP = new Set(["node_modules", "vendor"]);

/**
 * Find git clones below `root` (spec 5): directories containing a `.git` directory, at most
 * `maxDepth` levels below root. Skips `node_modules`, `vendor` and hidden folders, does not follow
 * symlinks, and does not descend into a clone once found. Unreadable folders are skipped.
 */
export async function findGitRepos(root: string, maxDepth = MAX_SCAN_DEPTH): Promise<string[]> {
  const found: string[] = [];

  async function visit(dir: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.name === ".git" && e.isDirectory())) {
      found.push(dir);
      return;
    }
    if (depth >= maxDepth) return;
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || SKIP.has(e.name)) continue;
      await visit(join(dir, e.name), depth + 1);
    }
  }

  await visit(root, 0);
  return found.sort();
}
