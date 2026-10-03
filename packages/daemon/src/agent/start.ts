import {
  agentFailed, placeholderValues, renderPlaybookBody, selectPlaybook, start,
  type Ctx, type Playbook, type TranscriptMessage, type WorkItem,
} from "@donepm/core";
import type { ItemWriter } from "../items/commit.js";
import type { ItemStore } from "../items/store.js";
import type { Log } from "../log.js";
import { loadPlaybooks } from "../playbooks/load.js";
import type { Exec } from "../process/exec.js";
import type { RepoStore } from "../repos/store.js";
import type { TranscriptStore } from "../transcript/store.js";
import { ensureWorktree, WorktreeError } from "../worktrees/create.js";
import { runSetup } from "../worktrees/setup.js";
import type { PushType } from "../ws/hub.js";
import { AgentBusyError, type AgentRunner } from "./runner.js";

export class StartError extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "StartError";
  }
}

export interface StartDeps {
  items: ItemStore;
  repos: RepoStore;
  writer: ItemWriter;
  runner: AgentRunner;
  transcript: TranscriptStore;
  push: (type: PushType, payload: unknown) => void;
  exec: Exec;
  ctx: Ctx;
  log: Log;
  playbooksDir: string;
  worktreeRoot: () => string;
  branchPrefix: () => string;
}

/**
 * Start (or restart) the agent for an item. Checks run synchronously and throw StartError; the
 * slow part (worktree, setup, spawn) runs in the background and ends in `failed` on any error.
 * Resolves with the item in `running` once the checks passed.
 */
export async function startItem(deps: StartDeps, itemId: string): Promise<{ item: WorkItem; done: Promise<void> }> {
  const stored = deps.items.get(itemId);
  if (!stored) throw new StartError(404, "item not found");
  const { item } = stored;
  if (item.state !== "ready" && item.state !== "failed") throw new StartError(409, `item is ${item.state}`);
  const repo = item.repoId ? deps.repos.get(item.repoId) : undefined;
  if (!repo) throw new StartError(409, "no local clone for this item's repository");

  const { playbooks, problems } = await loadPlaybooks(deps.playbooksDir, repo.path);
  for (const p of problems) deps.log.warn(p, "skipped invalid playbook");
  const playbook = playbooks.find((p) => p.name === item.playbook) ?? selectPlaybook(item, playbooks).selected;
  if (!playbook) throw new StartError(409, `playbook "${item.playbook}" not found`);

  let slot;
  try {
    slot = deps.runner.reserve(item.id);
  } catch (e) {
    if (e instanceof AgentBusyError) throw new StartError(409, e.message);
    throw e;
  }
  const running = deps.writer.commit(start(item, deps.ctx));
  const done = prepareAndLaunch(deps, running, playbook)
    .catch((e: unknown) => {
      const output = e instanceof WorktreeError ? e.output : undefined;
      fail(deps, itemId, (e as Error).message, output ? { output } : {});
    })
    .finally(() => slot.release());
  return { item: running, done };
}

async function prepareAndLaunch(deps: StartDeps, item: WorkItem, playbook: Playbook): Promise<void> {
  const repo = deps.repos.get(item.repoId!)!;
  const wt = await ensureWorktree({
    exec: deps.exec, item, repo, worktreeRoot: deps.worktreeRoot(), branchPrefix: deps.branchPrefix(),
  });
  if (wt.path !== item.worktreePath || wt.branch !== item.branch) {
    item = deps.writer.save({ ...item, worktreePath: wt.path, branch: wt.branch });
  }

  // Setup runs until the agent has run once, so a start after a failed setup tries it again.
  if (wt.created || !item.agentSessionId) {
    const ok = await runSetup({
      exec: deps.exec,
      repoPath: repo.path,
      worktree: wt.path,
      report: (step) => note(deps, item.id, step),
    });
    if (!ok) return fail(deps, item.id, "worktree setup failed");
  }

  const prompt = renderPlaybookBody(
    playbook.body,
    // `repoPath` is where the agent works: the worktree, not the main clone.
    placeholderValues({ ...item, branch: wt.branch, repoPath: wt.path }),
  );
  await deps.runner.launch({
    item, playbook, cwd: wt.path, prompt,
    ...(item.agentSessionId ? { resumeSessionId: item.agentSessionId } : {}),
  });
}

function note(deps: StartDeps, itemId: string, raw: unknown): void {
  const msg: TranscriptMessage = { id: deps.ctx.newId(), itemId, sessionId: "", at: deps.ctx.now(), kind: "system", raw };
  deps.transcript.append(msg);
  deps.push("transcript.appended", msg);
}

function fail(deps: StartDeps, itemId: string, reason: string, details: Record<string, unknown> = {}): void {
  const item = deps.items.get(itemId)?.item;
  if (item?.state !== "running") return;
  deps.writer.commit(agentFailed(item, deps.ctx, reason, details));
  deps.log.warn({ itemId, reason }, "agent start failed");
}
