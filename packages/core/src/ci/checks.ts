/**
 * One check of a pull request as `gh pr checks --json name,state,bucket,link,workflow,startedAt,
 * completedAt` reports it. `bucket` is gh's own grouping: pass, fail, pending, skipping, cancel.
 */
export interface CiCheck {
  name: string;
  bucket: string;
  state: string;
  link?: string;
  workflow?: string;
  startedAt?: string;
  completedAt?: string;
}

/** A failed check as `ci.failed` records it and the card shows it. */
export interface FailedCheck {
  name: string;
  link?: string;
  workflow?: string;
}

/** The end of a failed check's log, fetched by the daemon (`gh run view --log-failed`). */
export interface CheckLog {
  name: string;
  tail: string;
}

export type CiVerdict = { kind: "pending" } | { kind: "passed"; checks: number } | { kind: "failed"; failed: FailedCheck[] };

/**
 * How long a PR without any check counts as "checks not registered yet" before it counts as "no
 * CI" (decision D35). Checks appear a few seconds after a push.
 */
export const CI_GRACE_MS = 60_000;

const PASSED = new Set(["pass", "skipping"]);
const FAILED = new Set(["fail", "cancel"]);

/**
 * What the checks of a PR say, `waitingSince` being when the wait began (`ci.started`). All checks
 * count, required or not (D35), and the verdict waits until every one finished, so a red result
 * carries all failures at once.
 *
 * Within the grace period no checks means pending, and a failure that finished before the wait
 * began is stale (a rerun that has not restarted it yet) and counts as pending. After it, the
 * checks are taken as they are, so a wait never hangs on one of these.
 */
export function ciVerdict(checks: readonly CiCheck[], waitingSince: string, now: string, graceMs = CI_GRACE_MS): CiVerdict {
  const inGrace = Date.parse(now) - Date.parse(waitingSince) < graceMs;
  if (checks.length === 0) return inGrace ? { kind: "pending" } : { kind: "passed", checks: 0 };
  const stale = (c: CiCheck) => inGrace && c.completedAt !== undefined && Date.parse(c.completedAt) < Date.parse(waitingSince);
  const failed: FailedCheck[] = [];
  for (const c of checks) {
    if (PASSED.has(c.bucket)) continue;
    if (!FAILED.has(c.bucket) || stale(c)) return { kind: "pending" };
    failed.push({ name: c.name, ...(c.link ? { link: c.link } : {}), ...(c.workflow ? { workflow: c.workflow } : {}) });
  }
  return failed.length ? { kind: "failed", failed } : { kind: "passed", checks: checks.length };
}

/** The GitHub Actions run a check belongs to, from its link (`…/actions/runs/<id>/job/<id>`). */
export function runIdOf(link: string | undefined): string | undefined {
  return link?.match(/\/actions\/runs\/(\d+)(?:\/|$)/)?.[1];
}

/** The distinct runs of the failed checks: what "Rerun failed jobs" reruns. */
export function failedRuns(failed: readonly FailedCheck[]): string[] {
  return [...new Set(failed.flatMap((c) => runIdOf(c.link) ?? []))];
}

/**
 * The message that resumes the agent after a red CI. The agent cannot reach GitHub, so the
 * failures and their logs travel in the message.
 */
export function ciFixPrompt(input: { number?: number; failed: readonly FailedCheck[]; logs: readonly CheckLog[] }): string {
  const pr = input.number === undefined ? "the pull request" : `pull request #${input.number}`;
  const lines = [`CI failed on ${pr}. Failed checks:`, ...input.failed.map((c) => `- ${c.name}`)];
  for (const log of input.logs) lines.push("", `Log of "${log.name}" (end):`, "```", log.tail, "```");
  if (input.logs.length === 0) lines.push("", "No logs were available.");
  lines.push(
    "",
    "Fix the cause and commit. Then call the draft_push tool so the user can push the commits to the pull request.",
  );
  return lines.join("\n");
}
