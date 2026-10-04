import { externalIdOf, type Ctx, type SourceIssue, type WorkItem } from "@donepm/core";
import type { Config } from "../config/config.js";
import type { Db } from "../db/database.js";
import type { EventStore } from "../events/store.js";
import { applyClosedUpstream, issueOrigin, syncIssues } from "../items/sync.js";
import type { ItemStore } from "../items/store.js";
import type { Log } from "../log.js";
import type { Exec } from "../process/exec.js";
import { ignoredOrigins, isIgnored } from "../repos/ignore.js";
import type { RepoStore } from "../repos/store.js";
import { TombstoneStore } from "../retention/tombstones.js";
import type { SourcePollStatus, StatusStore } from "../status/status.js";
import { detectGh } from "./detect.js";
import { fetchAssignedIssues, fetchIssueState, fetchQueryIssues, type FetchResult } from "./issues.js";
import { fetchReviewRequests } from "./review-requests.js";

export interface CollectDeps {
  db: Db;
  exec: Exec;
  items: ItemStore;
  events: EventStore;
  repos: RepoStore;
  status: StatusStore;
  ctx: Ctx;
  log: Log;
  /** Per-repository queries (issue #32); repos without one only get the default search. */
  sources: () => Config["sources"];
  onItemUpdated: (item: WorkItem) => void;
}

const RAW_LOG_LIMIT = 10_000;

/**
 * One poll cycle (spec 6.2): the default search (assigned to me), the pull requests that ask for
 * the user's review (issue #48, D40), and one query per repository that has its own (issue #32),
 * merged by `externalId`. A failing source does not stop the others.
 * Ignored repositories (issue #33) are not polled, and their issues are dropped from the default search.
 * Never throws: failures are logged and recorded in the status, so Settings can show them.
 */
export async function collectIssues(deps: CollectDeps): Promise<void> {
  const { exec, repos, status, ctx, log } = deps;
  const at = ctx.now();
  try {
    if (status.get().gh?.state !== "ready") {
      status.update({ gh: await detectGh(exec) });
      if (status.get().gh?.state !== "ready") {
        status.update({ lastPoll: { at, ok: false, error: `gh ${status.get().gh?.state}` } });
        return;
      }
    }

    const sourceConfig = deps.sources();
    const ignored = ignoredOrigins(sourceConfig);
    const fetched: Array<{ origin?: string; label?: string; result: FetchResult }> = [
      {
        result: await fetchAssignedIssues(exec, () =>
          repos.all().map((r) => r.originUrl).filter((origin) => !isIgnored(sourceConfig, origin)),
        ),
      },
      { label: "review requests", result: await fetchReviewRequests(exec) },
    ];
    for (const [origin, source] of Object.entries(sourceConfig)) {
      if (source.query && !ignored.has(origin)) fetched.push({ origin, result: await fetchQueryIssues(exec, origin, source.query) });
    }

    const issues: SourceIssue[] = [];
    const errors: string[] = [];
    const sources: Record<string, SourcePollStatus> = {};
    for (const { origin, label, result } of fetched) {
      if (result.ok) {
        issues.push(...result.issues.filter((i) => !ignored.has(issueOrigin(i))));
        if (origin) sources[origin] = { ok: true, issues: result.issues.length };
        continue;
      }
      if (result.kind === "schema") {
        log.error({ origin, label, error: result.error, raw: result.raw.slice(0, RAW_LOG_LIMIT) }, "gh output failed schema validation");
      } else {
        log.warn({ origin, label, error: result.error }, "gh poll failed");
      }
      const where = origin ?? label;
      errors.push(where ? `${where}: ${result.error}` : result.error);
      if (origin) sources[origin] = { ok: false, error: result.error };
    }
    // The default search failing on the command maybe means logged out; detect again next cycle.
    const main = fetched[0]!.result;
    if (!main.ok && main.kind === "command") status.update({ gh: await detectGh(exec) });

    const synced = syncIssues(issues, deps, ignored);
    for (const item of [...synced.collected, ...synced.updated]) deps.onItemUpdated(item);

    // An item is only "missing" if every source answered; otherwise it may just not have been asked.
    if (errors.length === 0) {
      for (const item of synced.missing) {
        const [repository, number] = item.externalId.split("#");
        const state = await fetchIssueState(exec, repository!, Number(number));
        if (state !== "CLOSED") continue;
        const flagged = applyClosedUpstream(item.id, deps);
        if (flagged) deps.onItemUpdated(flagged);
      }
      // A purged issue seen closed is imported fresh if it ever shows up again (D37).
      const tombstones = new TombstoneStore(deps.db);
      for (const t of synced.openTombstones) {
        const [repository, number] = t.externalId.split("#");
        if ((await fetchIssueState(exec, repository!, Number(number))) === "CLOSED") tombstones.markClosed(t.externalId);
      }
    }

    const count = new Set(issues.map(externalIdOf)).size;
    log.info({ issues: count, collected: synced.collected.length, updated: synced.updated.length, failed: errors.length }, "poll done");
    status.update({
      lastPoll: {
        at,
        ok: errors.length === 0,
        ...(errors.length < fetched.length ? { issues: count } : {}),
        ...(errors.length ? { error: errors.join("; ") } : {}),
        ...(Object.keys(sources).length ? { sources } : {}),
      },
    });
  } catch (e) {
    log.error({ err: e }, "poll crashed");
    status.update({ lastPoll: { at, ok: false, error: (e as Error).message } });
  }
}
