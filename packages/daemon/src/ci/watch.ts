import { azureOrganizationUrl, ciFailed, ciPassed, ciVerdict, ciWaitOf, countOnce, type CiCheck, type CiPr, type Ctx, type WorkItem } from "@donepm/core";
import type { PipelinesOptIn } from "../config/pipelines.js";
import type { EventStore } from "../events/store.js";
import type { ItemWriter } from "../items/commit.js";
import type { ItemStore } from "../items/store.js";
import type { Log } from "../log.js";
import type { CiSource, PrChecks } from "../providers/ci-source.js";
import { noConnection, type Providers } from "../providers/registry.js";
import { ciSourceFor } from "./route.js";

export interface CiWatchDeps {
  items: ItemStore;
  events: EventStore;
  writer: ItemWriter;
  providers: Providers;
  ctx: Ctx;
  log: Log;
  /** The checks each poll read, pending ones included; the card shows them while CI runs. */
  onChecks?: (itemId: string, checks: CiCheck[]) => void;
  /**
   * A repository whose pipelines do not report to its host (issue #143): its CI is read from Azure
   * Pipelines by branch instead of from the pull request's checks, never both.
   */
  pipelinesOf?: (originUrl: string) => PipelinesOptIn | undefined;
  /** The commit an item's worktree is at, so the builds of it are the ones read. */
  headOf?: (item: WorkItem) => Promise<string | undefined>;
}

/**
 * Part of each poll (decision D35): for every item waiting for CI, read its PR's checks. All green
 * (or no CI at all) moves it to Done; a red check moves it to Needs you with the failures and the
 * ends of their logs. Never throws; a failing item does not stop the others.
 */
export async function watchCi(deps: CiWatchDeps): Promise<void> {
  for (const { item, originUrl } of deps.items.all()) {
    if (item.state !== "checking") continue;
    try {
      await check(deps, item, originUrl);
    } catch (e) {
      deps.log.warn({ itemId: item.id, err: e }, "checking CI failed");
    }
  }
}

async function check(deps: CiWatchDeps, item: WorkItem, originUrl: string): Promise<void> {
  const wait = ciWaitOf(deps.events.forItem(item.id));
  if (!wait) return;
  const ci = ciSourceFor(deps.providers, wait.pr.url);
  if (!ci) {
    deps.log.warn({ itemId: item.id, pr: wait.pr.url }, "no CI source for the pull request");
    return;
  }
  const checks = await checksOf(deps, ci, item, originUrl, wait.pr);
  if (!checks.ok) {
    deps.log.warn({ itemId: item.id, pr: wait.pr.url, error: checks.error }, "reading CI failed");
    return;
  }
  const counted = countOnce(checks.checks);
  deps.onChecks?.(item.id, counted);
  const verdict = ciVerdict(counted, wait.since, deps.ctx.now());
  if (verdict.kind === "pending") return;
  const logs = verdict.kind === "failed" ? await ci.failedLogs(wait.pr, verdict.failed) : [];
  // Re-read: the user may have marked it done while the CI source answered.
  const now = deps.items.get(item.id)?.item;
  if (now?.state !== "checking") return;
  deps.writer.commit(
    verdict.kind === "passed"
      ? ciPassed(now, deps.ctx, { ...wait.pr, checks: verdict.checks })
      : ciFailed(now, deps.ctx, { ...wait.pr, failed: verdict.failed, logs }),
  );
}

/** The pull request's checks on its host, or the opted-in pipelines' builds on its branch. */
async function checksOf(deps: CiWatchDeps, ci: CiSource, item: WorkItem, originUrl: string, pr: CiPr): Promise<PrChecks> {
  const pipelines = deps.pipelinesOf?.(originUrl);
  if (!pipelines) return ci.checks(pr);
  const organization = azureOrganizationUrl(pipelines.organization);
  const azure = deps.providers.ciSource(organization);
  if (!azure?.runsOn) return { ok: false, error: noConnection(organization) };
  if (!item.branch) return { ok: false, error: "the item has no branch to read builds of" };
  const head = await deps.headOf?.(item);
  return azure.runsOn({ project: pipelines.project, definitions: pipelines.definitions, branch: item.branch, ...(head ? { head } : {}) });
}
