import { join } from "node:path";
import { normalizeOriginUrl, parseCloneOrigin, type Ctx, type Repo } from "@donepm/core";
import type { Exec } from "../process/exec.js";
import type { Log } from "../log.js";
import { cloneTarget, hasGitDir } from "./clone.js";
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
 * gone. Clones without an origin cannot be matched to issues and are skipped. A stored clone at
 * `<root>/<owner>/<repo>` of its own origin is kept even where the scan does not look (an owner
 * named `vendor` or `.x`): donePM cloned it there (issue #37).
 */
export async function discoverRepos(deps: DiscoverDeps): Promise<Repo[]> {
  const { root, exec, repos, ctx, log } = deps;
  const scanned = await findGitRepos(root);
  const paths = [...scanned, ...(await clonedOutsideScan(repos, root, scanned))];
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

async function clonedOutsideScan(repos: RepoStore, root: string, scanned: readonly string[]): Promise<string[]> {
  const seen = new Set(scanned);
  const found: string[] = [];
  for (const repo of repos.all()) {
    const origin = parseCloneOrigin(repo.originUrl);
    if (!origin || seen.has(repo.path)) continue;
    // Clones on other hosts made before issue #141 landed at `<root>/<owner>/<repo>` too.
    const targets = [cloneTarget(root, origin), join(root, ...origin.path)];
    if (!targets.includes(repo.path)) continue;
    if (await hasGitDir(repo.path)) found.push(repo.path);
  }
  return found;
}
