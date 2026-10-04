import type { CheckLog, CiCheck, CiPr } from "@donepm/core";
import type { Done } from "./result.js";

export type PrChecks = { ok: true; checks: CiCheck[] } | { ok: false; error: string };

/**
 * Where CI runs (issue #138): the checks of a pull request, the ends of failed jobs' logs, and a
 * rerun of what failed. The verdict is `core`'s (`ciVerdict`); this only reads and normalises.
 */
export interface CiSource {
  checks(pr: CiPr): Promise<PrChecks>;
  /** One entry per failed job of the runs, named like its check. Any failure gives none. */
  failedLogs(pr: CiPr, runs: readonly string[]): Promise<CheckLog[]>;
  /** Rerun the failed jobs of each run; the user's click is the approval (D35). */
  rerunFailed(pr: CiPr, runs: readonly string[]): Promise<Done>;
}
