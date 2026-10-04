import { ciFailed, ciPassed, ciVerdict, ciWaitOf, failedRuns, type CheckLog, type CiCheck, type CiPr, type Ctx, type FailedCheck, type WorkItem } from "@donepm/core";
import type { EventStore } from "../events/store.js";
import type { ItemWriter } from "../items/commit.js";
import type { ItemStore } from "../items/store.js";
import type { Log } from "../log.js";
import type { CiSource } from "../providers/ci-source.js";
import type { Providers } from "../providers/registry.js";

export interface CiWatchDeps {
  items: ItemStore;
  events: EventStore;
  writer: ItemWriter;
  providers: Providers;
  ctx: Ctx;
  log: Log;
  /** The checks each poll read, pending ones included; the card shows them while CI runs. */
  onChecks?: (itemId: string, checks: CiCheck[]) => void;
}

/**
 * Part of each poll (decision D35): for every item waiting for CI, read its PR's checks. All green
 * (or no CI at all) moves it to Done; a red check moves it to Needs you with the failures and the
 * ends of their logs. Never throws; a failing item does not stop the others.
 */
export async function watchCi(deps: CiWatchDeps): Promise<void> {
  for (const { item } of deps.items.all()) {
    if (item.state !== "checking") continue;
    try {
      await check(deps, item);
    } catch (e) {
      deps.log.warn({ itemId: item.id, err: e }, "checking CI failed");
    }
  }
}

async function check(deps: CiWatchDeps, item: WorkItem): Promise<void> {
  const wait = ciWaitOf(deps.events.forItem(item.id));
  if (!wait) return;
  const ci = deps.providers.ciSource(wait.pr.url);
  if (!ci) {
    deps.log.warn({ itemId: item.id, pr: wait.pr.url }, "no CI source for the pull request");
    return;
  }
  const checks = await ci.checks(wait.pr);
  if (!checks.ok) {
    deps.log.warn({ itemId: item.id, pr: wait.pr.url, error: checks.error }, "gh pr checks failed");
    return;
  }
  deps.onChecks?.(item.id, checks.checks);
  const verdict = ciVerdict(checks.checks, wait.since, deps.ctx.now());
  if (verdict.kind === "pending") return;
  const logs = verdict.kind === "failed" ? await failedLogs(ci, wait.pr, verdict.failed) : [];
  // Re-read: the user may have marked it done while gh ran.
  const now = deps.items.get(item.id)?.item;
  if (now?.state !== "checking") return;
  deps.writer.commit(
    verdict.kind === "passed"
      ? ciPassed(now, deps.ctx, { ...wait.pr, checks: verdict.checks })
      : ciFailed(now, deps.ctx, { ...wait.pr, failed: verdict.failed, logs }),
  );
}

/** The log ends of the failed checks, fetched per run; checks of other CI have none. */
async function failedLogs(ci: CiSource, pr: CiPr, failed: readonly FailedCheck[]): Promise<CheckLog[]> {
  const names = new Set(failed.map((c) => c.name));
  return (await ci.failedLogs(pr, failedRuns(failed))).filter((l) => names.has(l.name));
}
