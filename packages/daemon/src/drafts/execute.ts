import {
  branchUpdatedMessage, branchUpdatePosted, draftApproved, draftExecuted, draftExecutionFailed, draftTitle, repliesPosted, reviewPosted,
  ticketDraftPosted, ticketDraftPostedMessage, type CiPr, type Draft, type DraftReply, type PostedReply, type PrDraftPayload, type PrDraftResult, type WorkItem,
} from "@donepm/core";
import type { ResumeHow } from "../agent/start.js";
import { requestBranchUpdate } from "../prs/update-branch.js";
import type { Exec, ExecResult } from "../process/exec.js";
import type { CodeHost } from "../providers/code-host.js";
import { noConnection, type Providers } from "../providers/registry.js";
import type { DraftResult } from "./store.js";
import { setupCopies } from "../worktrees/setup.js";
import { DraftError, type DraftDeps } from "./actions.js";
import { ticketOf } from "./ticket.js";

/** Commit message for changes the agent left uncommitted (D25). */
export const WIP_MESSAGE = "WIP from donePM";

const PUSH_TIMEOUT_MS = 120_000;

export type ExecutionStep = "commit" | "push" | "pr" | "reply" | "review" | "update_branch" | "ticket";

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
  providers: Providers;
  /** Ends the agent once its work is published. */
  stopAgent: (itemId: string) => Promise<void>;
  /**
   * Lets the agent go on after a draft that does not end its work (an update-branch draft, #148):
   * commits `how.transition` and sends `how.prompt`, to the live process or a resumed session.
   */
  continueAgent: (itemId: string, how: ResumeHow) => Promise<unknown>;
}

/**
 * The user approved a draft (spec 6.3): the daemon, never the agent, commits leftovers and pushes
 * the branch; for a PR draft it then opens the pull request with the user's edits. Either way the
 * item then waits for the PR's CI (D35). Replies to review feedback are posted after the push; a
 * comment draft only posts them, and the item is done again (D39). A review draft posts the review of
 * someone else's pull request, and the item is done (D43). An update-branch draft asks for someone
 * else's pull request to be brought up to date (#148); the agent then goes on with its review. A failed draft can be approved again
 * (Retry). Throws DraftError before anything ran; ExecutionError once a step failed, with the draft
 * `failed` and the item still waiting for the user.
 */
export async function approveDraft(deps: ApproveDeps, draftId: string): Promise<Draft> {
  const draft = deps.drafts.get(draftId);
  if (!draft) throw new DraftError(404, "draft not found");
  if (draft.state !== "pending" && draft.state !== "failed") throw new DraftError(409, `draft is already ${draft.state}`);
  const item = deps.items.get(draft.itemId)?.item;
  if (!item) throw new DraftError(404, "item not found");
  if (item.state !== "needs_you") throw new DraftError(409, `the item is ${item.state}, not waiting for the user`);
  if (draft.type === "update_branch") return updateBranch(deps, draft, item);
  if (draft.type === "ticket_comment" || draft.type === "ticket_transition") return changeTicket(deps, draft, item);
  const repo = item.repoId ? deps.repos.get(item.repoId) : undefined;
  if (!repo || !item.worktreePath || !item.branch) throw new DraftError(409, "the item has no worktree");

  deps.drafts.setState(draft.id, "approved", deps.ctx.now());
  let current = deps.writer.commit(draftApproved(item, deps.ctx, draft.id));

  const where = { worktree: item.worktreePath, branch: item.branch };
  let result: DraftResult;
  let pr: CiPr;
  try {
    if (draft.type === "pr") {
      result = await publish(deps.exec, codeHost(deps, "pr", repo.originUrl), { ...where, repo: repo.originUrl, payload: draft.userEdits ?? draft.payload });
      pr = result;
    } else if (draft.type === "push") {
      pr = { number: draft.payload.number, url: draft.payload.url };
      const pushed = await pushCommits(deps.exec, where);
      const replies = draft.payload.replies ?? [];
      result = replies.length
        ? { ...pushed, posted: await postReplies(deps, draft.id, pr, replies, draft.result?.posted ?? [], (posted) => ({ ...pushed, posted })) }
        : pushed;
    } else if (draft.type === "review") {
      pr = { number: draft.payload.number, url: draft.payload.url };
      const posted = await codeHost(deps, "review", pr.url).postReview(draft.payload);
      if (!posted.ok) throw new ExecutionError("review", `posting the review failed: ${posted.error}`);
      result = posted.result;
    } else {
      pr = { number: draft.payload.number, url: draft.payload.url };
      result = { posted: await postReplies(deps, draft.id, pr, draft.payload.replies, draft.result?.posted ?? [], (posted) => ({ posted })) };
    }
  } catch (e) {
    const step = draft.type === "comment" ? "reply" : draft.type;
    const err = e instanceof ExecutionError ? e : new ExecutionError(step, (e as Error).message);
    deps.drafts.setState(draft.id, "failed", deps.ctx.now());
    current = itemNow(deps, current);
    deps.writer.commit(draftExecutionFailed(current, deps.ctx, draft.id, { step: err.step, error: err.message }));
    throw err;
  }

  deps.drafts.setResult(draft.id, result, deps.ctx.now());
  current = itemNow(deps, current);
  deps.writer.commit(
    draft.type === "comment"
      ? repliesPosted(current, deps.ctx, draft.id, { ...result })
      : draft.type === "review"
        ? reviewPosted(current, deps.ctx, draft.id, { ...result })
        : draftExecuted(current, deps.ctx, draft.id, { number: pr.number, url: pr.url }, { ...result }),
  );
  await deps.stopAgent(item.id).catch(() => {});
  return { ...draft, state: "executed", result } as Draft;
}

/**
 * An approved update-branch draft (#148): `@dependabot rebase` or `gh pr update-branch`, as the
 * user. The review is not done yet, so the agent runs again with word of it instead of being
 * stopped. Needs no worktree: nothing local changes.
 */
async function updateBranch(deps: ApproveDeps, draft: Extract<Draft, { type: "update_branch" }>, item: WorkItem): Promise<Draft> {
  deps.drafts.setState(draft.id, "approved", deps.ctx.now());
  let current = deps.writer.commit(draftApproved(item, deps.ctx, draft.id));
  const done = await requestBranchUpdate(deps.providers, current).catch((e: Error) => ({ ok: false as const, error: e.message }));
  if (!done.ok) {
    const err = new ExecutionError("update_branch", `updating the branch failed: ${done.error}`);
    deps.drafts.setState(draft.id, "failed", deps.ctx.now());
    current = itemNow(deps, current);
    deps.writer.commit(draftExecutionFailed(current, deps.ctx, draft.id, { step: err.step, error: err.message }));
    throw err;
  }
  const result = { via: done.via, ...(done.url ? { url: done.url } : {}) };
  deps.drafts.setResult(draft.id, result, deps.ctx.now());
  await deps.continueAgent(item.id, {
    transition: (latest, ctx) => branchUpdatePosted(latest, ctx, draft.id, { ...result }),
    prompt: branchUpdatedMessage(done.via, draft.payload.base),
  });
  return { ...draft, state: "executed", result };
}

type TicketDraft = Extract<Draft, { type: "ticket_comment" | "ticket_transition" }>;

/**
 * An approved ticket draft (issue #139): the comment is posted, or the ticket moved, as the user.
 * The work is not done by that, so the agent runs again with word of it. Needs no worktree.
 */
async function changeTicket(deps: ApproveDeps, draft: TicketDraft, item: WorkItem): Promise<Draft> {
  const { ref, source } = ticketOf(deps.providers, item);
  deps.drafts.setState(draft.id, "approved", deps.ctx.now());
  let current = deps.writer.commit(draftApproved(item, deps.ctx, draft.id));
  const p = draft.payload;
  const done =
    draft.type === "ticket_comment"
      ? await source.comment!(ref, draft.payload.body).catch((e: Error) => ({ ok: false as const, error: e.message }))
      : await source
          .transition!(ref, draft.payload.transitionId, draft.payload.comment)
          .then((r) => (r.ok ? { ...r, status: draft.payload.toStatus } : r))
          .catch((e: Error) => ({ ok: false as const, error: e.message }));
  if (!done.ok) {
    const what = draft.type === "ticket_comment" ? `commenting on ${p.key}` : `moving ${p.key}`;
    const err = new ExecutionError("ticket", `${what} failed: ${done.error}`);
    deps.drafts.setState(draft.id, "failed", deps.ctx.now());
    current = itemNow(deps, current);
    deps.writer.commit(draftExecutionFailed(current, deps.ctx, draft.id, { step: err.step, error: err.message }));
    throw err;
  }
  const { ok: _ok, ...result } = done;
  deps.drafts.setResult(draft.id, result as DraftResult, deps.ctx.now());
  await deps.continueAgent(item.id, {
    transition: (latest, ctx) => ticketDraftPosted(latest, ctx, draft.id, { ...result }),
    prompt: ticketDraftPostedMessage(draftTitle(draft)),
  });
  return { ...draft, state: "executed", result } as Draft;
}

/**
 * Post the replies in order, skipping those an earlier attempt posted. Each one is stored as
 * posted at once, so a failure halfway and a retry never post a reply twice.
 */
async function postReplies(
  deps: ApproveDeps,
  draftId: string,
  pr: CiPr,
  replies: readonly DraftReply[],
  already: readonly PostedReply[],
  progress: (posted: PostedReply[]) => DraftResult,
): Promise<PostedReply[]> {
  const posted = [...already];
  for (const [index, reply] of replies.entries()) {
    if (posted.some((p) => p.index === index)) continue;
    const r = await codeHost(deps, "reply", pr.url).reply(pr, reply);
    if (!r.ok) throw new ExecutionError("reply", `posting reply ${index + 1} of ${replies.length} failed: ${r.error}`);
    posted.push({ index, url: r.url });
    deps.drafts.setProgress(draftId, progress(posted), deps.ctx.now());
  }
  return posted;
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
    const ticket = draft.type === "ticket_comment" || draft.type === "ticket_transition";
    deps.writer.commit(
      draftExecutionFailed(
        item,
        deps.ctx,
        draft.id,
        ticket
          ? { step: "ticket", error: "donePM stopped while changing the ticket; check it, then retry" }
          : { step: "pr", error: "donePM stopped while publishing; check GitHub, then retry" },
      ),
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
async function pushCommits(exec: Exec, input: Where): Promise<{ sha: string }> {
  await commitAndPush(exec, input);
  const head = await gitIn(exec, input.worktree)("rev-parse", "HEAD");
  check(head, "push", "git rev-parse");
  return { sha: head.stdout.trim() };
}

async function publish(exec: Exec, host: CodeHost, input: Where & { repo: string; payload: PrDraftPayload }): Promise<PrDraftResult> {
  await commitAndPush(exec, input);
  const { title, body, base } = input.payload;
  const created = await host.createPr({ origin: input.repo, head: input.branch, base, title, body, cwd: input.worktree });
  if (!created.ok) throw new ExecutionError("pr", created.error);
  return created.pr;
}

/** The code host of the item's repository or pull request; none fails the step. */
function codeHost(deps: ApproveDeps, step: ExecutionStep, where: string): CodeHost {
  const host = deps.providers.codeHost(where);
  if (!host) throw new ExecutionError(step, noConnection(where));
  return host;
}

function check(r: ExecResult, step: ExecutionStep, what: string): void {
  if (r.code === 0) return;
  const out = (r.stderr || r.stdout).trim();
  throw new ExecutionError(step, out ? `${what} failed: ${out}` : `${what} exited with code ${r.code}`);
}
