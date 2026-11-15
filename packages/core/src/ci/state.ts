import type { Event } from "../event/types.js";
import type { CiPr } from "../item/transitions.js";
import { failedRuns, type CheckLog, type FailedCheck } from "./checks.js";

/** The wait the last `ci.started` began: since when, for which PR. */
export interface CiWait {
  since: string;
  pr: CiPr;
}

/** A red CI the user has not acted on yet, from its `ci.failed` event. */
export interface CiFailure {
  pr?: CiPr;
  failed: FailedCheck[];
  logs: CheckLog[];
  /** GitHub Actions run ids and Azure Pipelines build URLs "Rerun failed jobs" reruns; empty when no check links to one. */
  runs: string[];
}

const prOf = (p: Record<string, unknown>): CiPr | undefined =>
  typeof p.number === "number" && typeof p.url === "string" ? { number: p.number, url: p.url } : undefined;

/** The current CI wait of a `checking` item; undefined if no `ci.started` names a PR. */
export function ciWaitOf(events: readonly Event[]): CiWait | undefined {
  const started = events.findLast((e) => e.type === "ci.started");
  const pr = started && prOf(started.payload);
  return started && pr ? { since: started.at, pr } : undefined;
}

const MOVES = /^(ci|agent|draft)\./;

/**
 * The red CI an item waits on: `ci.failed` is the last thing that happened to its agent, drafts and
 * CI. Fixing, rerunning or marking it done each add an event after it.
 */
export function ciFailureOf(events: readonly Event[]): CiFailure | undefined {
  const last = events.findLast((e) => MOVES.test(e.type));
  if (last?.type !== "ci.failed") return undefined;
  const p = last.payload;
  const failed = Array.isArray(p.failed) ? (p.failed as FailedCheck[]).filter((c) => typeof c?.name === "string") : [];
  const logs = Array.isArray(p.logs) ? (p.logs as CheckLog[]).filter((l) => typeof l?.name === "string" && typeof l.tail === "string") : [];
  const pr = prOf(p);
  return { ...(pr ? { pr } : {}), failed, logs, runs: failedRuns(failed) };
}
