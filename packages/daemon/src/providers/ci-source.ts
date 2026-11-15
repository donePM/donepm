import type { CheckLog, CiCheck, CiPr, FailedCheck } from "@donepm/core";
import type { Done } from "./result.js";

export type PrChecks = { ok: true; checks: CiCheck[] } | { ok: false; error: string };

/** The builds of some pipelines on one branch, for a repository whose CI does not report to its host (issue #143). */
export interface BranchRuns {
  project: string;
  definitions: readonly number[];
  branch: string;
  /** The commit the branch should be at; builds of it are preferred when known. */
  head?: string;
}

/**
 * Where CI runs (issues #138, #143): the checks of a pull request, the ends of failed jobs' logs, and a
 * rerun of what failed. The verdict is `core`'s (`ciVerdict`); this only reads and normalises.
 */
export interface CiSource {
  checks(pr: CiPr): Promise<PrChecks>;
  /**
   * The log ends of the failed checks that belong to this source's runs, each named like its
   * check; it skips the others. Any failure gives none: CI's verdict does not depend on them.
   */
  failedLogs(pr: CiPr, failed: readonly FailedCheck[]): Promise<CheckLog[]>;
  /** Rerun the failed jobs of each run (core `failedRuns`); the user's click is the approval (D35). */
  rerunFailed(pr: CiPr, runs: readonly string[]): Promise<Done>;
  /** The latest builds of pipelines on a branch, as checks: Azure Pipelines only (issue #143). */
  runsOn?(query: BranchRuns): Promise<PrChecks>;
}
