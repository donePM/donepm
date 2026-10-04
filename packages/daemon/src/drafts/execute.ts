import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  draftApproved, draftExecuted, draftExecutionFailed,
  type CiPr, type Draft, type PrDraftPayload, type PrDraftResult, type PushDraftResult, type WorkItem,
} from "@donepm/core";
import type { Exec, ExecResult } from "../process/exec.js";
import { setupCopies } from "../worktrees/setup.js";
import { DraftError, type DraftDeps } from "./actions.js";

/** Commit message for changes the agent left uncommitted (D25). */
export const WIP_MESSAGE = "WIP from donePM";

const PUSH_TIMEOUT_MS = 120_000;

export type ExecutionStep = "commit" | "push" | "pr";

export class ExecutionError extends Error {
  constructor(
    readonly step: ExecutionStep,
    message: string,
  ) {
    super(message);
    this.name = "ExecutionError";
  }
}

export interface ApproveDeps extends DraftDeps {
  exec: Exec;
  /** Ends the agent once its work is published. */
  stopAgent: (itemId: string) => Promise<void>;
}

/**
 * The user approved a draft (spec 6.3): the daemon, never the agent, commits leftovers and pushes
 * the branch; for a PR draft it then opens the pull request with the user's edits. Either way the
 * item then waits for the PR's CI (D35). A failed draft can be approved again (Retry). Throws DraftError before anything ran; ExecutionError once a step failed, with
 * the draft `failed` and the item still waiting for the user.
 */
export async function approveDraft(deps: ApproveDeps, draftId: string): Promise<Draft> {
  const draft = deps.drafts.get(draftId);
  if (!draft) throw new DraftError(404, "draft not found");
  if (draft.state !== "pending" && draft.state !== "failed") throw new DraftError(409, `draft is already ${draft.state}`);
  const item = deps.items.get(draft.itemId)?.item;
  if (!item) throw new DraftError(404, "item not found");
  if (item.state !== "needs_you") throw new DraftError(409, `the item is ${item.state}, not waiting for the user`);
  const repo = item.repoId ? deps.repos.get(item.repoId) : undefined;
  if (!repo || !item.worktreePath || !item.branch) throw new DraftError(409, "the item has no worktree");

  deps.drafts.setState(draft.id, "approved", deps.ctx.now());
  let current = deps.writer.commit(draftApproved(item, deps.ctx, draft.id));

  const where = { worktree: item.worktreePath, branch: item.branch };
  let result: PrDraftResult | PushDraftResult;
  let pr: CiPr;
  try {
    if (draft.type === "pr") {
      result = await publish(deps.exec, { ...where, repo: repo.originUrl, payload: draft.userEdits ?? draft.payload });
      pr = result;
    } else {
      result = await pushCommits(deps.exec, where);
      pr = { number: draft.payload.number, url: draft.payload.url };
    }
  } catch (e) {
    const err = e instanceof ExecutionError ? e : new ExecutionError(draft.type, (e as Error).message);
    deps.drafts.setState(draft.id, "failed", deps.ctx.now());
    current = itemNow(deps, current);
    deps.writer.commit(draftExecutionFailed(current, deps.ctx, draft.id, { step: err.step, error: err.message }));
    throw err;
  }

  deps.drafts.setResult(draft.id, result, deps.ctx.now());
  current = itemNow(deps, current);
  deps.writer.commit(draftExecuted(current, deps.ctx, draft.id, { number: pr.number, url: pr.url }, { ...result }));
  await deps.stopAgent(item.id).catch(() => {});
  return { ...draft, state: "executed", result } as Draft;
}

/**
 * On start: a draft still `approved` was being published when the daemon stopped. Whether the push
 * or the PR happened is unknown, so it is marked failed; Retry pushes again (a no-op if it is
 * there) and `gh pr create` says so if the PR already exists.
 */
export function failInterrupted(deps: DraftDeps): void {
  for (const draft of deps.drafts.inState("approved")) {
    deps.drafts.setState(draft.id, "failed", deps.ctx.now());
    const item = deps.items.get(draft.itemId)?.item;
    if (item?.state !== "needs_you") continue;
    deps.writer.commit(
      draftExecutionFailed(item, deps.ctx, draft.id, { step: "pr", error: "donePM stopped while publishing; check GitHub, then retry" }),
    );
  }
}

/** Re-read the item: the agent may have changed it while git and gh ran. */
function itemNow(deps: DraftDeps, fallback: WorkItem): WorkItem {
  return deps.items.get(fallback.id)?.item ?? fallback;
}

interface Where {
  worktree: string;
  branch: string;
}

const gitIn = (exec: Exec, worktree: string) => (...args: string[]) =>
  exec("git", ["-C", worktree, ...args], { timeoutMs: PUSH_TIMEOUT_MS });

/** Commit what the agent left uncommitted (D25), then push the branch. */
async function commitAndPush(exec: Exec, input: Where): Promise<void> {
  const git = gitIn(exec, input.worktree);
  const status = await git("status", "--porcelain");
  check(status, "commit", "git status");
  if (status.stdout.trim()) {
    // What setup copied in (`.env` and the like) stays out of the commit.
    const keepOut = (await setupCopies(input.worktree)).map((f) => `:(exclude,literal)${f}`);
    check(await git("add", "--all", "--", ".", ...keepOut), "commit", "git add");
    // Exit 1: something is staged. 0: only setup's copies were left, nothing to commit.
    const staged = await git("diff", "--cached", "--quiet");
    if (staged.code === 1) check(await git("commit", "--message", WIP_MESSAGE), "commit", "git commit");
    else check(staged, "commit", "git diff --cached");
  }
  check(await git("push", "--set-upstream", "origin", input.branch), "push", "git push");
}

/** A push draft: the new commits go to the branch the PR already tracks. */
async function pushCommits(exec: Exec, input: Where): Promise<PushDraftResult> {
  await commitAndPush(exec, input);
  const head = await gitIn(exec, input.worktree)("rev-parse", "HEAD");
  check(head, "push", "git rev-parse");
  return { sha: head.stdout.trim() };
}

async function publish(exec: Exec, input: Where & { repo: string; payload: PrDraftPayload }): Promise<PrDraftResult> {
  await commitAndPush(exec, input);

  const dir = mkdtempSync(join(tmpdir(), "donepm-pr-"));
  try {
    const bodyFile = join(dir, "body.md");
    writeFileSync(bodyFile, input.payload.body, { mode: 0o600 });
    const pr = await exec(
      "gh",
      [
        "pr", "create", "--repo", input.repo, "--head", input.branch, "--base", input.payload.base,
        "--title", input.payload.title, "--body-file", bodyFile,
      ],
      { cwd: input.worktree, timeoutMs: PUSH_TIMEOUT_MS },
    );
    check(pr, "pr", "gh pr create");
    return prResult(pr.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function check(r: ExecResult, step: ExecutionStep, what: string): void {
  if (r.code === 0) return;
  const out = (r.stderr || r.stdout).trim();
  throw new ExecutionError(step, out ? `${what} failed: ${out}` : `${what} exited with code ${r.code}`);
}

/** `gh pr create` prints the new pull request's URL as its last line. */
export function prResult(stdout: string): PrDraftResult {
  const url = stdout.trim().split("\n").at(-1)?.trim() ?? "";
  const m = /\/pull\/(\d+)$/.exec(url);
  if (!m) throw new ExecutionError("pr", `gh pr create printed no pull request URL: ${stdout.trim() || "(nothing)"}`);
  return { url, number: Number(m[1]) };
}
