import { existsSync } from "node:fs";
import {
  agentFailed, chooseAgent, placeholderValues, playbookProblems, renderPlaybookBody, resume, selectPlaybook, start,
  type AgentKind, type Ctx, type Playbook, type Transition, type TranscriptMessage, type WorkItem,
} from "@donepm/core";
import type { Config } from "../config/config.js";
import type { TicketSourceConfig } from "../config/ticket-sources.js";
import { assignOnStart } from "../gh/assign-on-start.js";
import type { ItemWriter } from "../items/commit.js";
import type { ItemStore } from "../items/store.js";
import type { Log } from "../log.js";
import { loadPlaybooks } from "../playbooks/load.js";
import type { Exec } from "../process/exec.js";
import type { Providers } from "../providers/registry.js";
import type { RepoStore } from "../repos/store.js";
import type { TranscriptStore } from "../transcript/store.js";
import { isManaged } from "../repos/managed.js";
import { ensureWorktree, WorktreeError } from "../worktrees/create.js";
import { ensureReviewWorktree } from "../worktrees/review.js";
import { runSetup } from "../worktrees/setup.js";
import type { PushType } from "../ws/hub.js";
import { AgentBusyError, type AgentRunner } from "./runner.js";

/** First message of a resumed session (spec 9.5); the session already holds the task. */
export const RESUME_PROMPT = "Continue where you left off.";

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
  providers: Providers;
  ctx: Ctx;
  log: Log;
  playbooksDir: string;
  worktreeRoot: () => string;
  branchPrefix: () => string;
  /** Per-repository source settings; `assignOnStart` lives there (issue #32). */
  sources: () => Config["sources"];
  /** Jira searches and their `assignOnStart` (issue #139). */
  ticketSources?: () => readonly TicketSourceConfig[];
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
  // A ticket of several repositories waits for the user to pick one (issue #139).
  if (item.repoCandidates && !item.repoOrigin) throw new StartError(409, "choose the repository to work in first");
  // Work starts only in a repository the user chose (D46); a resume finishes what was started.
  if (!isManaged(deps.sources(), stored.originUrl)) throw new StartError(409, `${stored.originUrl} is not managed`);
  const playbook = await playbookFor(deps, item);
  const agent = agentFor(deps, item, playbook, stored.originUrl);
  const slot = reserve(deps, item.id);
  const running = deps.writer.commit(start(item, deps.ctx, agent));
  const launched = prepareAndLaunch(deps, running, playbook)
    .catch((e: unknown) => {
      const output = e instanceof WorktreeError ? e.output : undefined;
      fail(deps, itemId, (e as Error).message, output ? { output } : {});
    })
    .finally(() => slot.release());
  const assigned = assignOnStart(deps, itemId, deps.repos.get(item.repoId!)!.originUrl).catch((e: unknown) =>
    deps.log.error({ err: e, itemId }, "assign on start crashed"),
  );
  const done = Promise.all([launched, assigned]).then(() => undefined);
  return { item: running, done };
}

/** How a resumed session starts: the transition to `running` and the first message. */
export interface ResumeHow {
  transition: (item: WorkItem, ctx: Ctx) => Transition;
  prompt: string;
}

const PLAIN_RESUME: ResumeHow = { transition: resume, prompt: RESUME_PROMPT };

/**
 * Resume a waiting item whose process is gone, e.g. after a daemon restart (spec 9.5): `--resume`
 * with the stored session in the existing worktree, and a short message instead of the playbook.
 * A rejected draft passes its own transition and the rejection as the message.
 */
export async function resumeItem(
  deps: StartDeps,
  itemId: string,
  how: ResumeHow = PLAIN_RESUME,
): Promise<{ item: WorkItem; done: Promise<void> }> {
  const stored = deps.items.get(itemId);
  if (!stored) throw new StartError(404, "item not found");
  const { item } = stored;
  if (item.state !== "needs_you") throw new StartError(409, `item is ${item.state}`);
  if (deps.runner.isRunning(item.id)) throw new StartError(409, "the agent is still running");
  if (!item.agentSessionId) throw new StartError(409, "no agent session to resume");
  if (!item.worktreePath || !existsSync(item.worktreePath)) throw new StartError(409, "the item has no worktree");
  const playbook = await playbookFor(deps, item);
  const slot = reserve(deps, item.id);
  let running: WorkItem;
  try {
    running = deps.writer.commit(how.transition(item, deps.ctx));
  } catch (e) {
    slot.release();
    throw e;
  }
  const done = deps.runner
    .launch({ item: running, playbook, cwd: item.worktreePath, prompt: how.prompt, resumeSessionId: item.agentSessionId })
    .catch((e: unknown) => fail(deps, itemId, (e as Error).message))
    .finally(() => slot.release());
  return { item: running, done };
}

async function playbookFor(deps: StartDeps, item: WorkItem): Promise<Playbook> {
  const repo = item.repoId ? deps.repos.get(item.repoId) : undefined;
  if (!repo) throw new StartError(409, "no local clone for this item's repository");
  const { playbooks, problems } = await loadPlaybooks(deps.playbooksDir, repo.path);
  for (const p of problems) deps.log.warn(p, "skipped invalid playbook");
  const playbook = playbooks.find((p) => p.name === item.playbook) ?? selectPlaybook(item, playbooks).selected;
  if (!playbook) throw new StartError(409, `playbook "${item.playbook}" not found`);
  return playbook;
}

/** The item's agent (D49), refused when the playbook asks for something that agent cannot do. */
function agentFor(deps: StartDeps, item: WorkItem, playbook: Playbook, origin: string): AgentKind {
  const repo = deps.sources()[origin];
  const agent = chooseAgent({ item, playbook, ...(repo ? { repo } : {}) });
  const settings = { permissionMode: playbook.permissionMode, ...(playbook.effort ? { effort: playbook.effort } : {}) };
  const problems = playbookProblems(settings, agent);
  if (problems.length > 0) throw new StartError(409, `playbook "${playbook.name}": ${problems.join("; ")}`);
  return agent;
}

function reserve(deps: StartDeps, itemId: string): { release: () => void } {
  try {
    return deps.runner.reserve(itemId);
  } catch (e) {
    if (e instanceof AgentBusyError) throw new StartError(409, e.message);
    throw e;
  }
}

async function prepareAndLaunch(deps: StartDeps, item: WorkItem, playbook: Playbook): Promise<void> {
  const repo = deps.repos.get(item.repoId!)!;
  const review = item.source === "github-pr";
  const wtInput = { exec: deps.exec, providers: deps.providers, item, repo, worktreeRoot: deps.worktreeRoot(), branchPrefix: deps.branchPrefix() };
  // A pull request to review is checked out at its head and compared against its own base (D41).
  const wt = review ? await ensureReviewWorktree(wtInput) : { ...(await ensureWorktree(wtInput)), baseBranch: undefined };
  if (wt.path !== item.worktreePath || wt.branch !== item.branch || wt.baseBranch !== item.baseBranch) {
    item = deps.writer.save({ ...item, worktreePath: wt.path, branch: wt.branch, ...(wt.baseBranch ? { baseBranch: wt.baseBranch } : {}) });
  }
  // A session belongs to its directory: in a new worktree the agent starts over.
  if (wt.created && item.agentSessionId) {
    const { agentSessionId: _session, ...fresh } = item;
    item = deps.writer.save(fresh);
  }

  // Setup runs until the agent has run once, so a start after a failed setup tries it again. Never
  // for a review: `.donepm/setup.yml` and the dependencies come from code nobody vetted yet (D41).
  if (!review && (wt.created || !item.agentSessionId)) {
    const ok = await runSetup({
      exec: deps.exec,
      repoPath: repo.path,
      worktree: wt.path,
      report: (step) => note(deps, item.id, step),
    });
    if (!ok) return fail(deps, item.id, "worktree setup failed");
  }

  // A retry with a session continues it; the session already holds the task.
  const prompt = item.agentSessionId
    ? RESUME_PROMPT
    : renderPlaybookBody(
        playbook.body,
        // `repoPath` is where the agent works: the worktree, not the main clone.
        placeholderValues({ ...item, branch: wt.branch, base: wt.baseBranch ?? repo.defaultBranch, repoPath: wt.path }),
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
