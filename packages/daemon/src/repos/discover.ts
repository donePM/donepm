import { normalizeOriginUrl, type Ctx, type Repo } from "@donepm/core";
import type { Exec } from "../process/exec.js";
import type { Log } from "../log.js";
import { readDefaultBranch, readOrigin } from "./git.js";
import { findGitRepos } from "./scan.js";
import type { RepoStore } from "./store.js";

export interface DiscoverDeps {
  root: string;
  exec: Exec;
  repos: RepoStore;
  ctx: Ctx;
  log: Log;
}

/**
 * Scan `root`, read origin and default branch of every clone, store them, and drop repos that are
 * gone. Clones without an origin cannot be matched to issues and are skipped.
 */
export async function discoverRepos(deps: DiscoverDeps): Promise<Repo[]> {
  const { root, exec, repos, ctx, log } = deps;
  const paths = await findGitRepos(root);
  const kept: string[] = [];
  const scannedAt = ctx.now();

  for (const path of paths) {
    const origin = await readOrigin(exec, path);
    if (!origin) {
      log.info({ path }, "repo without origin skipped");
      continue;
    }
    const { branch, fromRef } = await readDefaultBranch(exec, path);
    if (!fromRef) log.warn({ path, branch }, "origin/HEAD not set, assuming default branch");
    const repo: Repo = {
      id: repos.byPath(path)?.id ?? ctx.newId(),
      path,
      originUrl: normalizeOriginUrl(origin),
      defaultBranch: branch,
    };
    repos.upsert(repo, scannedAt);
    kept.push(path);
  }

  repos.removeExcept(kept);
  log.info({ root, found: kept.length }, "repo scan done");
  return repos.all();
}
