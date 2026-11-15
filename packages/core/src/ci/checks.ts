import { azureBuildUrl, parseAzureBuildLink } from "./azure.js";

/**
 * One check of a pull request as `gh pr checks --json name,state,bucket,link,workflow,startedAt,
 * completedAt` reports it. `bucket` is gh's own grouping: pass, fail, pending, skipping, cancel.
 * Other CI sources (Azure DevOps policies, Azure Pipelines builds, issue #143) report the same shape.
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

/**
 * The end of a failed check's log, fetched by the daemon (`gh run view --log-failed`, or the failed
 * tasks of an Azure Pipelines build), named like its check.
 */
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

/**
 * The run a check belongs to, which "Rerun failed jobs" reruns: a GitHub Actions run's id, or an
 * Azure Pipelines build's URL (`azureBuildUrl`, issue #143). Undefined for a check of other CI.
 */
export function runOf(link: string | undefined): string | undefined {
  const actions = runIdOf(link);
  if (actions) return actions;
  const build = parseAzureBuildLink(link);
  return build && azureBuildUrl(build);
}

/** The distinct runs of the failed checks: what "Rerun failed jobs" reruns. */
export function failedRuns(failed: readonly FailedCheck[]): string[] {
  return [...new Set(failed.flatMap((c) => runOf(c.link) ?? []))];
}

/** Whether a run of `failedRuns` is an Azure Pipelines build rather than a GitHub Actions run. */
export function isAzureRun(run: string): boolean {
  return parseAzureBuildLink(run) !== undefined;
}

/**
 * What makes two checks one (issue #143): an Azure Pipelines build, or one job of it, whichever
 * view reports it. Undefined for any other check, which always counts on its own.
 */
function buildKeyOf(c: CiCheck): string | undefined {
  const build = parseAzureBuildLink(c.link);
  return build && `${azureBuildUrl(build)}${build.jobId ? `#${build.jobId}` : ""}`;
}

const FINISHED = new Set(["pass", "fail", "cancel", "skipping"]);
const time = (t: string | undefined) => (t === undefined || Number.isNaN(Date.parse(t)) ? -Infinity : Date.parse(t));

/** `a` describes a later state of the build than `b`. */
function newer(a: CiCheck, b: CiCheck): boolean {
  const started = time(a.startedAt) - time(b.startedAt);
  if (started !== 0 && !Number.isNaN(started)) return started > 0;
  const finished = Number(FINISHED.has(a.bucket)) - Number(FINISHED.has(b.bucket));
  if (finished !== 0) return finished > 0;
  return time(a.completedAt) > time(b.completedAt);
}

/**
 * The checks with each Azure Pipelines build (or job of one) counted once (issue #143, D53): of
 * the checks naming the same build, the attempt that started last wins, and of two views of the
 * same attempt the finished one, then the one that finished last. So a retried build counts by its
 * retry, still running or not, and a stale view of an earlier attempt never flips the verdict.
 * Other checks are kept as they are, in their order.
 */
export function countOnce(checks: readonly CiCheck[]): CiCheck[] {
  const out: CiCheck[] = [];
  const at = new Map<string, number>();
  for (const c of checks) {
    const key = buildKeyOf(c);
    const i = key === undefined ? undefined : at.get(key);
    if (i === undefined) {
      if (key !== undefined) at.set(key, out.length);
      out.push(c);
    } else if (newer(c, out[i]!)) out[i] = c;
  }
  return out;
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
