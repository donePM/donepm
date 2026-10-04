import { issueAssigned, issueAssignFailed, type Ctx } from "@donepm/core";
import type { Config } from "../config/config.js";
import type { ItemWriter } from "../items/commit.js";
import type { ItemStore } from "../items/store.js";
import type { Log } from "../log.js";
import type { Exec } from "../process/exec.js";
import { assignIssueToMe } from "./issues.js";

export interface AssignDeps {
  items: ItemStore;
  writer: ItemWriter;
  exec: Exec;
  ctx: Ctx;
  log: Log;
  sources: () => Config["sources"];
}

/**
 * Decision D28: when the item's repository opted in (`assignOnStart`), the daemon assigns the
 * issue to the gh user as the user presses Start. The agent never does this. The outcome is an
 * event; a failure does not stop the agent. Resolves once the outcome is recorded.
 */
export async function assignOnStart(deps: AssignDeps, itemId: string, origin: string): Promise<void> {
  if (!deps.sources()[origin]?.assignOnStart) return;
  const stored = deps.items.get(itemId);
  // A pull request to review is someone else's; there is nothing to assign (D40).
  if (!stored || stored.item.source !== "github-issue") return;
  const [repository, number] = stored.item.externalId.split("#");
  let result: Awaited<ReturnType<typeof assignIssueToMe>>;
  try {
    result = await assignIssueToMe(deps.exec, repository!, Number(number));
  } catch (e) {
    result = { ok: false, error: (e as Error).message };
  }
  // The agent moved the item on meanwhile; record against where it is now.
  const now = deps.items.get(itemId)?.item;
  if (!now) return;
  if (result.ok) {
    deps.writer.commit(issueAssigned(now, deps.ctx, { assignee: "@me" }));
  } else {
    deps.log.warn({ itemId, error: result.error }, "assign on start failed");
    deps.writer.commit(issueAssignFailed(now, deps.ctx, result.error));
  }
}
