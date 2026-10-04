import type { Exec } from "../process/exec.js";
import type { OrphanWorktree } from "./reconcile.js";

/** An orphan as Settings lists it: how much disk it takes and when it was last committed to. */
export interface OrphanDetails extends OrphanWorktree {
  sizeBytes?: number;
  lastCommitAt?: string;
}

/** `du -sk` and the last commit's date per orphan. What cannot be read is left out. */
export async function withOrphanDetails(exec: Exec, orphans: readonly OrphanWorktree[]): Promise<OrphanDetails[]> {
  return Promise.all(
    orphans.map(async (o) => {
      const [du, log] = await Promise.all([
        exec("du", ["-sk", o.path]),
        exec("git", ["-C", o.path, "log", "-1", "--format=%cI"]),
      ]);
      const kb = du.code === 0 ? Number.parseInt(du.stdout, 10) : Number.NaN;
      const at = log.code === 0 ? log.stdout.trim() : "";
      return { ...o, ...(Number.isFinite(kb) ? { sizeBytes: kb * 1024 } : {}), ...(at ? { lastCommitAt: at } : {}) };
    }),
  );
}
