import type { Ctx, WorkItem } from "@donepm/core";
import type { Db } from "../db/database.js";
import type { EventStore } from "../events/store.js";
import { applyClosedUpstream, syncIssues } from "../items/sync.js";
import type { ItemStore } from "../items/store.js";
import type { Log } from "../log.js";
import type { Exec } from "../process/exec.js";
import type { RepoStore } from "../repos/store.js";
import type { StatusStore } from "../status/status.js";
import { detectGh } from "./detect.js";
import { fetchAssignedIssues, fetchIssueState } from "./issues.js";

export interface CollectDeps {
  db: Db;
  exec: Exec;
  items: ItemStore;
  events: EventStore;
  repos: RepoStore;
  status: StatusStore;
  ctx: Ctx;
  log: Log;
  onItemUpdated: (item: WorkItem) => void;
}

const RAW_LOG_LIMIT = 10_000;

/**
 * One poll cycle (spec 6.2). Never throws: failures are logged and recorded in the status, so
 * Settings can show an error badge.
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

    const result = await fetchAssignedIssues(exec, () => repos.all().map((r) => r.originUrl));
    if (!result.ok) {
      if (result.kind === "schema") {
        log.error({ error: result.error, raw: result.raw.slice(0, RAW_LOG_LIMIT) }, "gh output failed schema validation");
      } else {
        log.warn({ error: result.error }, "gh poll failed");
        // Maybe logged out meanwhile; detect again on the next cycle.
        status.update({ gh: await detectGh(exec) });
      }
      status.update({ lastPoll: { at, ok: false, error: result.error } });
      return;
    }

    const synced = syncIssues(result.issues, deps);
    for (const item of [...synced.collected, ...synced.updated]) deps.onItemUpdated(item);

    for (const item of synced.missing) {
      const [repository, number] = item.externalId.split("#");
      const state = await fetchIssueState(exec, repository!, Number(number));
      if (state !== "CLOSED") continue;
      const flagged = applyClosedUpstream(item.id, deps);
      if (flagged) deps.onItemUpdated(flagged);
    }

    log.info({ issues: result.issues.length, collected: synced.collected.length, updated: synced.updated.length }, "poll done");
    status.update({ lastPoll: { at, ok: true, issues: result.issues.length } });
  } catch (e) {
    log.error({ err: e }, "poll crashed");
    status.update({ lastPoll: { at, ok: false, error: (e as Error).message } });
  }
}
