import { DEFAULT_AGENT, type AgentKind } from "../agent/kind.js";
import type { Ctx } from "../ids.js";
import type { Event, EventActor, EventType } from "../event/types.js";
import type { PrConflict } from "../pr/conflict.js";
import type { FeedbackEntry, PrFeedback } from "../pr/feedback.js";
import type { ItemSource, ItemState, WorkItem } from "./types.js";

export interface Transition {
  item: WorkItem;
  events: Event[];
}

/** A playbook the repository does not offer for the item's ingest (issue #153). */
export class PlaybookNotAllowedError extends Error {
  constructor(
    readonly playbook: string,
    readonly source: ItemSource,
  ) {
    super(`playbook "${playbook}" is not offered for ${source === "github-pr" ? "pull requests" : "issues"} of this repository`);
    this.name = "PlaybookNotAllowedError";
  }
}

/** A ticket with several repositories waits for the user to choose one before it starts (issue #139). */
export class RepoNotChosenError extends Error {
  constructor() {
    super("choose the repository this ticket's work goes to first");
    this.name = "RepoNotChosenError";
  }
}

/** The repository asked for is not one of the ticket's (issue #139). */
export class NotARepoCandidateError extends Error {
  constructor(readonly origin: string) {
    super(`${origin} is not one of this ticket's repositories`);
    this.name = "NotARepoCandidateError";
  }
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly transition: string,
    readonly from: ItemState,
  ) {
    super(`Invalid transition "${transition}" from state "${from}"`);
    this.name = "InvalidTransitionError";
  }
}

interface Spec {
  name: string;
  from: ItemState[];
  to: ItemState;
  actor: EventActor;
  event: EventType | ((item: WorkItem) => EventType);
}

function apply(
  spec: Spec,
  item: WorkItem,
  ctx: Ctx,
  refId?: string,
  payload: Record<string, unknown> = {},
): Transition {
  if (!spec.from.includes(item.state)) throw new InvalidTransitionError(spec.name, item.state);
  const at = ctx.now();
  const type = typeof spec.event === "function" ? spec.event(item) : spec.event;
  const event: Event = { id: ctx.newId(), itemId: item.id, at, actor: spec.actor, type, payload };
  if (refId !== undefined) event.refId = refId;
  const stateSince = spec.to === item.state ? item.stateSince : at;
  return { item: { ...item, state: spec.to, stateSince, updatedAt: at }, events: [event] };
}

/**
 * Ready (or failed, as retry) to running. Emits `agent.resumed` if a session already exists.
 * The first start sets `startedAt`; a retry keeps it, so the card keeps its place in In Progress.
 * The first start also fixes the item's agent (`chooseAgent`); a later start keeps it, because the
 * session belongs to it. An item with a session from before #136 is Claude Code's.
 */
export function start(item: WorkItem, ctx: Ctx, agent: AgentKind = DEFAULT_AGENT): Transition {
  if (item.repoCandidates !== undefined && item.repoOrigin === undefined) throw new RepoNotChosenError();
  const t = apply(
    {
      name: "start",
      from: ["ready", "failed"],
      to: "running",
      actor: "system",
      event: (i) => (i.agentSessionId ? "agent.resumed" : "agent.started"),
    },
    item,
    ctx,
  );
  const agentKind = item.agentKind ?? (item.agentSessionId ? DEFAULT_AGENT : agent);
  const started = { ...t.item, agentKind, ...(item.startedAt === undefined ? { startedAt: t.item.stateSince } : {}) };
  return { ...t, item: started };
}

/**
 * The user chooses which of a ticket's repositories its work goes to (issue #139), as
 * `item.repo_chosen` with `{ origin }`. Only until the agent first starts: after that the work is in
 * that repository's worktree. Choosing the repository the item already has changes nothing. The
 * daemon links the item to that repository's clone.
 */
export function repoChosen(item: WorkItem, ctx: Ctx, origin: string): Transition {
  if (item.repoCandidates === undefined || !item.repoCandidates.includes(origin)) throw new NotARepoCandidateError(origin);
  if (item.startedAt !== undefined || wasStarted(item)) throw new InvalidTransitionError("repoChosen", item.state);
  const t = apply({ name: "repoChosen", from: ["ready"], to: "ready", actor: "user", event: "item.repo_chosen" }, item, ctx, undefined, { origin });
  if (item.repoOrigin === origin) return { item, events: [] };
  return { ...t, item: { ...t.item, repoOrigin: origin } };
}

/**
 * The user picks another agent for the item (issue #136). A session belongs to the agent that made
 * it, so the session is dropped and the next start begins a fresh one; the transcript stays. Only
 * from Ready or Failed: never while the agent runs, and not while the item waits on that session.
 * Picking the agent the item already has changes nothing.
 */
export function agentKindChanged(item: WorkItem, ctx: Ctx, agentKind: AgentKind): Transition {
  const t = apply(
    { name: "agentKindChanged", from: ["ready", "failed"], to: item.state, actor: "user", event: "agent.kind_changed" },
    item,
    ctx,
    undefined,
    { from: item.agentKind ?? null, to: agentKind, ...(item.agentSessionId ? { droppedSession: item.agentSessionId } : {}) },
  );
  if (item.agentKind === agentKind) return { item, events: [] };
  const { agentSessionId: _session, ...rest } = t.item;
  return { ...t, item: { ...rest, agentKind } };
}

/**
 * Agent raised a permission question. `askId` is the PermissionAsk id. Allowed while already
 * waiting too: tool calls running in parallel can each ask.
 */
export function agentAsked(
  item: WorkItem,
  ctx: Ctx,
  askId: string,
  payload: Record<string, unknown> = {},
): Transition {
  return apply(
    { name: "agentAsked", from: ["running", "needs_you"], to: "needs_you", actor: "agent", event: "permission.asked" },
    item,
    ctx,
    askId,
    payload,
  );
}

/** User answered a permission question. The item keeps waiting while `othersPending` asks remain. */
export function answered(
  item: WorkItem,
  ctx: Ctx,
  askId: string,
  payload: Record<string, unknown> = {},
  othersPending = false,
): Transition {
  return apply(
    {
      name: "answered",
      from: ["needs_you"],
      to: othersPending ? "needs_you" : "running",
      actor: "user",
      event: "permission.answered",
    },
    item,
    ctx,
    askId,
    payload,
  );
}

/**
 * The daemon, not the user, denied a pending ask because the process is being stopped (Stop or
 * shutdown, spec 9.5). The item keeps its state; only the event is new.
 */
export function askDeniedBySystem(item: WorkItem, ctx: Ctx, askId: string, message: string): Transition {
  return apply(
    { name: "askDeniedBySystem", from: ["running", "needs_you"], to: item.state, actor: "system", event: "permission.answered" },
    item,
    ctx,
    askId,
    { behavior: "deny", message, reason: message },
  );
}

/**
 * The daemon restarted while the agent was running or mid-turn waiting on a question (spec 9.5).
 * The process is gone; the item waits for the user to resume the session.
 */
export function interrupted(item: WorkItem, ctx: Ctx, reason: string): Transition {
  return apply(
    { name: "interrupted", from: ["running", "needs_you"], to: "needs_you", actor: "system", event: "agent.interrupted" },
    item,
    ctx,
    undefined,
    { reason },
  );
}

/** User resumed a waiting item whose process is gone: `--resume` with the stored session. */
export function resume(item: WorkItem, ctx: Ctx): Transition {
  if (!item.agentSessionId) throw new InvalidTransitionError("resume", item.state);
  return apply(
    { name: "resume", from: ["needs_you"], to: "running", actor: "user", event: "agent.resumed" },
    item,
    ctx,
  );
}

/**
 * The agent's turn ended without a pending ask or draft (spec 9.3, `result`). The user decides
 * what happens next, so the item waits in Needs You.
 */
export function turnEnded(item: WorkItem, ctx: Ctx, payload: Record<string, unknown> = {}): Transition {
  return apply(
    { name: "turnEnded", from: ["running"], to: "needs_you", actor: "agent", event: "agent.turn_ended" },
    item,
    ctx,
    undefined,
    payload,
  );
}

/**
 * The CLI started a turn on its own, e.g. after a background task notification (a second `init`
 * mid-session, spec 9.3). The item is running again.
 */
export function turnStarted(item: WorkItem, ctx: Ctx): Transition {
  return apply(
    { name: "turnStarted", from: ["needs_you"], to: "running", actor: "agent", event: "agent.turn_started" },
    item,
    ctx,
  );
}

/** Agent created a draft. */
export function draftCreated(
  item: WorkItem,
  ctx: Ctx,
  draftId: string,
  payload: Record<string, unknown> = {},
): Transition {
  return apply(
    { name: "draftCreated", from: ["running"], to: "needs_you", actor: "agent", event: "draft.created" },
    item,
    ctx,
    draftId,
    payload,
  );
}

/** User edited a pending draft. The item keeps waiting for the user. */
export function draftEdited(item: WorkItem, ctx: Ctx, draftId: string): Transition {
  return apply(
    { name: "draftEdited", from: ["needs_you"], to: "needs_you", actor: "user", event: "draft.edited" },
    item,
    ctx,
    draftId,
  );
}

/**
 * User approved the draft. The item keeps waiting while the daemon executes it; `draftExecuted`
 * or `draftExecutionFailed` follows.
 */
export function draftApproved(item: WorkItem, ctx: Ctx, draftId: string): Transition {
  return apply(
    { name: "draftApproved", from: ["needs_you"], to: "needs_you", actor: "user", event: "draft.approved" },
    item,
    ctx,
    draftId,
  );
}

/** The pull request a CI wait is about, as `ci.*` events carry it. */
export interface CiPr {
  number: number;
  url: string;
}

/**
 * The daemon executed an approved draft (spec 6.3): the PR is open or the commits are pushed to it.
 * The item waits for the PR's CI (decision D35), so `ci.started` follows `draft.executed`.
 * `payload` holds the result.
 */
export function draftExecuted(
  item: WorkItem,
  ctx: Ctx,
  draftId: string,
  pr: CiPr,
  payload: Record<string, unknown> = {},
): Transition {
  const executed = apply(
    { name: "draftExecuted", from: ["needs_you"], to: "checking", actor: "system", event: "draft.executed" },
    item,
    ctx,
    draftId,
    payload,
  );
  const started = apply(
    { name: "draftExecuted", from: ["checking"], to: "checking", actor: "system", event: "ci.started" },
    executed.item,
    ctx,
    draftId,
    { ...pr },
  );
  return { item: started.item, events: [...executed.events, ...started.events] };
}

/**
 * Every check of the PR passed, or none appeared within the grace period (D35). The item is done.
 * `payload.checks` is how many there were.
 */
export function ciPassed(item: WorkItem, ctx: Ctx, payload: Record<string, unknown> = {}): Transition {
  return apply({ name: "ciPassed", from: ["checking"], to: "done", actor: "system", event: "ci.passed" }, item, ctx, undefined, payload);
}

/** A check failed. The user decides: fix with the agent, rerun, or mark done anyway. */
export function ciFailed(item: WorkItem, ctx: Ctx, payload: Record<string, unknown> = {}): Transition {
  return apply(
    { name: "ciFailed", from: ["checking"], to: "needs_you", actor: "system", event: "ci.failed" },
    item,
    ctx,
    undefined,
    payload,
  );
}

/** The user reran the failed jobs; the item waits for CI again. `payload.runs` are the reruns. */
export function ciRerun(item: WorkItem, ctx: Ctx, pr: CiPr, runs: readonly string[]): Transition {
  return apply(
    { name: "ciRerun", from: ["needs_you"], to: "checking", actor: "user", event: "ci.started" },
    item,
    ctx,
    undefined,
    { ...pr, reason: "rerun", runs: [...runs] },
  );
}

/**
 * The user called the item done although CI is red, or before it finished (D35). The event says
 * so; the card does not hide it.
 */
export function ciMarkedDone(item: WorkItem, ctx: Ctx, payload: Record<string, unknown> = {}): Transition {
  return apply(
    { name: "ciMarkedDone", from: ["checking", "needs_you"], to: "done", actor: "user", event: "ci.marked_done" },
    item,
    ctx,
    undefined,
    payload,
  );
}

/** The user sent the CI failure to the agent: `--resume` with the failure as the message. */
export function ciFix(item: WorkItem, ctx: Ctx): Transition {
  if (!item.agentSessionId) throw new InvalidTransitionError("ciFix", item.state);
  return apply(
    { name: "ciFix", from: ["needs_you"], to: "running", actor: "user", event: "agent.resumed" },
    item,
    ctx,
    undefined,
    { reason: "ci_failed" },
  );
}

/**
 * Executing an approved draft failed. The item keeps waiting for the user, who can retry.
 * `payload` holds the failed step and its output.
 */
export function draftExecutionFailed(
  item: WorkItem,
  ctx: Ctx,
  draftId: string,
  payload: Record<string, unknown> = {},
): Transition {
  return apply(
    { name: "draftExecutionFailed", from: ["needs_you"], to: "needs_you", actor: "system", event: "draft.execution_failed" },
    item,
    ctx,
    draftId,
    payload,
  );
}

/** User rejected the draft; the reason goes back to the agent, which runs again. */
export function draftRejected(
  item: WorkItem,
  ctx: Ctx,
  draftId: string,
  reason?: string,
): Transition {
  return apply(
    { name: "draftRejected", from: ["needs_you"], to: "running", actor: "user", event: "draft.rejected" },
    item,
    ctx,
    draftId,
    reason === undefined ? {} : { reason },
  );
}

/**
 * Agent process or worktree setup failed. Possible while running or while waiting for the user.
 * `details` go into the event payload next to the reason, e.g. `{ stderrTail }` or `{ output }`.
 */
export function agentFailed(
  item: WorkItem,
  ctx: Ctx,
  reason?: string,
  details: Record<string, unknown> = {},
): Transition {
  return apply(
    { name: "agentFailed", from: ["running", "needs_you"], to: "failed", actor: "system", event: "agent.failed" },
    item,
    ctx,
    undefined,
    reason === undefined ? details : { ...details, reason },
  );
}

/**
 * User removed the item's worktree (spec 7.4). The state stays; the worktree path and the session
 * (which belongs to that directory) are cleared, so a retry starts fresh. The branch is kept.
 */
export function worktreeRemoved(item: WorkItem, ctx: Ctx, payload: Record<string, unknown> = {}): Transition {
  return withoutWorktree(
    apply(
      { name: "worktreeRemoved", from: ["done", "failed"], to: item.state, actor: "user", event: "worktree.removed" },
      item,
      ctx,
      undefined,
      payload,
    ),
  );
}

/**
 * The daemon removed a done item's worktree because its pull request was merged and the user
 * turned on `removeWorktreeOnMerge` (decision D33). Same effect as the user's button; the event
 * carries `reason: "pr_merged"` and the PR.
 */
export function worktreeRemovedOnMerge(item: WorkItem, ctx: Ctx, payload: Record<string, unknown> = {}): Transition {
  return withoutWorktree(
    apply(
      { name: "worktreeRemovedOnMerge", from: ["done"], to: "done", actor: "system", event: "worktree.removed" },
      item,
      ctx,
      undefined,
      { ...payload, reason: "pr_merged" },
    ),
  );
}

/**
 * The user changed the worktree root and chose to move the item's worktree along (issue #93). The
 * state and the session stay: `claude --resume <id>` finds a session by its id from any directory
 * (D44). Never under a running agent: its process works in the old directory.
 */
export function worktreeMoved(item: WorkItem, ctx: Ctx, move: { from: string; to: string }): Transition {
  const t = apply(
    {
      name: "worktreeMoved",
      from: ["ready", "needs_you", "checking", "done", "failed"],
      to: item.state,
      actor: "user",
      event: "worktree.moved",
    },
    item,
    ctx,
    undefined,
    { from: move.from, to: move.to },
  );
  return { ...t, item: { ...t.item, worktreePath: move.to } };
}

function withoutWorktree(t: Transition): Transition {
  const { worktreePath: _path, agentSessionId: _session, ...rest } = t.item;
  return { ...t, item: rest };
}

/** The pull request a done item's draft opened was merged on GitHub (D33). Not a state change. */
export function prMerged(item: WorkItem, ctx: Ctx, payload: Record<string, unknown> = {}): Transition {
  return apply(
    { name: "prMerged", from: ["done"], to: "done", actor: "system", event: "item.pr_merged" },
    item,
    ctx,
    undefined,
    payload,
  );
}

/**
 * The PR was merged but the daemon left the worktree in place, e.g. because it holds uncommitted
 * changes (D33). `reason` is what the card shows.
 */
export function worktreeRemoveSkipped(
  item: WorkItem,
  ctx: Ctx,
  reason: string,
  details: Record<string, unknown> = {},
): Transition {
  return apply(
    { name: "worktreeRemoveSkipped", from: ["done"], to: "done", actor: "system", event: "worktree.remove_skipped" },
    item,
    ctx,
    undefined,
    { ...details, reason },
  );
}

const ALL_STATES: ItemState[] = ["ready", "running", "needs_you", "checking", "done", "failed"];

/**
 * GitHub reports the item's open PR as conflicting with its base (decision D36). A finished item or
 * one waiting for CI comes back to the user; `from` is where it returns once the conflict is gone.
 */
export function prConflicted(item: WorkItem, ctx: Ctx, payload: CiPr & { base: string; files: string[] }): Transition {
  return apply(
    { name: "prConflicted", from: ["done", "checking"], to: "needs_you", actor: "system", event: "pr.conflicted" },
    item,
    ctx,
    undefined,
    { ...payload, from: item.state },
  );
}

/**
 * GitHub reports the PR mergeable again, or it was merged or closed. An item still waiting on the
 * conflict returns to where it was; any other keeps its state and only loses the note.
 */
export function prConflictResolved(item: WorkItem, ctx: Ctx, conflict: PrConflict): Transition {
  const to = conflict.waiting && item.state === "needs_you" ? conflict.from : item.state;
  return apply(
    { name: "prConflictResolved", from: ALL_STATES, to, actor: "system", event: "pr.conflict_resolved" },
    item,
    ctx,
    undefined,
    { ...conflict.pr },
  );
}

/** "I'll do it myself": the item returns to where it was; the card keeps a note until it is resolved. */
export function prConflictDismissed(item: WorkItem, ctx: Ctx, conflict: PrConflict): Transition {
  if (!conflict.waiting) throw new InvalidTransitionError("prConflictDismissed", item.state);
  return apply(
    { name: "prConflictDismissed", from: ["needs_you"], to: conflict.from, actor: "user", event: "pr.conflict_dismissed" },
    item,
    ctx,
    undefined,
    { ...conflict.pr },
  );
}

/** The user let the agent resolve the conflict: `--resume` with the conflict as the message. */
export function prConflictFix(item: WorkItem, ctx: Ctx): Transition {
  if (!item.agentSessionId) throw new InvalidTransitionError("prConflictFix", item.state);
  return apply(
    { name: "prConflictFix", from: ["needs_you"], to: "running", actor: "user", event: "agent.resumed" },
    item,
    ctx,
    undefined,
    { reason: "pr_conflict" },
  );
}

/**
 * Someone reviewed the done item's open PR (decision D39): the item comes back to the user with the
 * new feedback. `entries` are only what no earlier `pr.feedback` had.
 */
export function prFeedback(item: WorkItem, ctx: Ctx, payload: CiPr & { entries: FeedbackEntry[] }): Transition {
  return apply(
    { name: "prFeedback", from: ["done"], to: "needs_you", actor: "system", event: "pr.feedback" },
    item,
    ctx,
    undefined,
    { ...payload },
  );
}

/** The user let the agent address the feedback: `--resume` with the feedback as the message. */
export function prFeedbackFix(item: WorkItem, ctx: Ctx): Transition {
  if (!item.agentSessionId) throw new InvalidTransitionError("prFeedbackFix", item.state);
  return apply(
    { name: "prFeedbackFix", from: ["needs_you"], to: "running", actor: "user", event: "agent.resumed" },
    item,
    ctx,
    undefined,
    { reason: "pr_feedback" },
  );
}

/** "Mark done": the user handles the feedback, or it needs nothing. The item is done again. */
export function prFeedbackDismissed(item: WorkItem, ctx: Ctx, feedback: PrFeedback): Transition {
  if (!feedback.waiting) throw new InvalidTransitionError("prFeedbackDismissed", item.state);
  return apply(
    { name: "prFeedbackDismissed", from: ["needs_you"], to: "done", actor: "user", event: "pr.feedback_dismissed" },
    item,
    ctx,
    undefined,
    { ...feedback.pr },
  );
}

/**
 * The daemon posted the replies of an approved comment draft (D39). No commit changed, so there is
 * no CI to wait for: the item is done again.
 */
export function repliesPosted(item: WorkItem, ctx: Ctx, draftId: string, payload: Record<string, unknown> = {}): Transition {
  return apply(
    { name: "repliesPosted", from: ["needs_you"], to: "done", actor: "system", event: "draft.executed" },
    item,
    ctx,
    draftId,
    payload,
  );
}

/**
 * The daemon posted the approved review of someone else's pull request (D43). The item's work is
 * that review, so it is done.
 */
export function reviewPosted(item: WorkItem, ctx: Ctx, draftId: string, payload: Record<string, unknown> = {}): Transition {
  return apply(
    { name: "reviewPosted", from: ["needs_you"], to: "done", actor: "system", event: "draft.executed" },
    item,
    ctx,
    draftId,
    payload,
  );
}

/**
 * The daemon asked for the branch of someone else's pull request to be updated, on the user's
 * approval of the agent's update-branch draft (issue #148, D47). The review is not done yet, so the
 * agent runs again and goes on with it.
 */
export function branchUpdatePosted(item: WorkItem, ctx: Ctx, draftId: string, payload: Record<string, unknown> = {}): Transition {
  return apply(
    { name: "branchUpdatePosted", from: ["needs_you"], to: "running", actor: "system", event: "draft.executed" },
    item,
    ctx,
    draftId,
    payload,
  );
}

/**
 * donePM merged someone else's pull request (D47): the user's Merge click, or the daemon on the
 * user's auto-merge choice. The item is done, and so is its pull request.
 */
export function reviewedPrMerged(item: WorkItem, ctx: Ctx, merge: { method: string; auto: boolean }): Transition {
  if (item.source !== "github-pr") throw new InvalidTransitionError("reviewedPrMerged", item.state);
  const t = apply(
    { name: "reviewedPrMerged", from: ["ready", "done"], to: "done", actor: merge.auto ? "system" : "user", event: "pr.merged" },
    item,
    ctx,
    undefined,
    { ...merge },
  );
  const at = t.events[0]!.at;
  return { ...t, item: { ...t.item, ...(item.prStatus ? { prStatus: { ...item.prStatus, state: "MERGED", closedAt: at } } : {}) } };
}

/**
 * The daemon assigned the issue to the user on start (opt-in per repository, decision D28). Not a
 * state change; the item stays where the agent took it meanwhile.
 */
export function issueAssigned(item: WorkItem, ctx: Ctx, payload: Record<string, unknown> = {}): Transition {
  return apply(
    { name: "issueAssigned", from: ALL_STATES, to: item.state, actor: "system", event: "item.assigned" },
    item,
    ctx,
    undefined,
    payload,
  );
}

/** Assigning on start failed. The agent keeps running; the event shows why. */
export function issueAssignFailed(item: WorkItem, ctx: Ctx, reason: string): Transition {
  return apply(
    { name: "issueAssignFailed", from: ALL_STATES, to: item.state, actor: "system", event: "item.assign_failed" },
    item,
    ctx,
    undefined,
    { reason },
  );
}

/**
 * The daemon answered a permission question itself: a WebFetch to a host on the user's list
 * (decision D31). Not a state change; the agent never waited on the user.
 */
export function autoAllowed(item: WorkItem, ctx: Ctx, askId: string, payload: Record<string, unknown> = {}): Transition {
  return apply(
    { name: "autoAllowed", from: ["running", "needs_you"], to: item.state, actor: "system", event: "permission.auto_allowed" },
    item,
    ctx,
    askId,
    payload,
  );
}

/**
 * The retention job took a finished item off the board (decision D37). The state stays `done`;
 * nothing is deleted. `finishedAt` (from `finishedAt` in `finished.ts`) goes into the event.
 */
export function archived(item: WorkItem, ctx: Ctx, finishedAt: string): Transition {
  if (item.archivedAt !== undefined) throw new InvalidTransitionError("archived", item.state);
  const t = apply(
    { name: "archived", from: ["done"], to: "done", actor: "system", event: "item.archived" },
    item,
    ctx,
    undefined,
    { finishedAt },
  );
  return { ...t, item: { ...t.item, archivedAt: t.events[0]!.at } };
}

/** A grant as its events carry it (decision D38). */
export interface GrantRef {
  id: string;
  repo: string;
  toolName: string;
  ruleContent?: string;
}

const grantPayload = (g: GrantRef) => ({
  grantId: g.id, repo: g.repo, toolName: g.toolName, ...(g.ruleContent !== undefined ? { ruleContent: g.ruleContent } : {}),
});

/**
 * "Always allow in <repo>" (decision D38): the user's allow, as `answered`, plus one
 * `permission.granted` per new grant. A rule the repository already had needs no new grant.
 */
export function alwaysAllowed(
  item: WorkItem,
  ctx: Ctx,
  askId: string,
  grants: readonly GrantRef[],
  othersPending = false,
): Transition {
  const t = answered(item, ctx, askId, { behavior: "allow", rules: [], always: grants.map(grantPayload) }, othersPending);
  const at = t.events[0]!.at;
  const granted: Event[] = grants.map((g) => ({
    id: ctx.newId(), itemId: item.id, at, actor: "user", type: "permission.granted", payload: { ...grantPayload(g), askId }, refId: g.id,
  }));
  return { ...t, events: [...t.events, ...granted] };
}

/**
 * The user removed a grant in Settings. Recorded on the item it was granted on; the item keeps its
 * state, whatever it is now.
 */
export function grantRevoked(item: WorkItem, ctx: Ctx, grant: GrantRef): Transition {
  return apply(
    { name: "grantRevoked", from: ALL_STATES, to: item.state, actor: "user", event: "permission.grant_revoked" },
    item,
    ctx,
    grant.id,
    grantPayload(grant),
  );
}

/** Work an agent may have left: a worktree or a session. Such an item is never closed for the user. */
export function wasStarted(item: WorkItem): boolean {
  return item.worktreePath !== undefined || item.agentSessionId !== undefined;
}

/**
 * The issue of a never-started item was closed upstream (decision D32). Nothing can be lost, so the
 * daemon moves it to Done itself. A started item only gets the badge (`markClosedUpstream`).
 */
export function closedUpstream(item: WorkItem, ctx: Ctx): Transition {
  if (wasStarted(item)) throw new InvalidTransitionError("closedUpstream", item.state);
  const t = apply(
    { name: "closedUpstream", from: ["ready"], to: "done", actor: "system", event: "item.closed_upstream" },
    item,
    ctx,
  );
  return { ...t, item: { ...t.item, closedUpstream: true } };
}

/**
 * The user moved an item whose issue was closed upstream to Done (decision D32). Not while the agent
 * runs: the user stops it first. The worktree stays until the user removes it.
 */
export function dismissed(item: WorkItem, ctx: Ctx): Transition {
  if (item.closedUpstream !== true) throw new InvalidTransitionError("dismissed", item.state);
  return apply(
    { name: "dismissed", from: ["ready", "needs_you", "failed"], to: "done", actor: "user", event: "item.dismissed" },
    item,
    ctx,
  );
}

/**
 * The user picked another playbook on a Ready card (spec 12.1). Only before the first start: a
 * running or started item keeps the playbook its session began with. Only one of `allowed`, the
 * playbooks the repository offers the item's ingest (issue #153, `allowedPlaybooks`).
 */
export function playbookChanged(item: WorkItem, ctx: Ctx, playbook: string, allowed: readonly string[]): Transition {
  if (item.startedAt !== undefined) throw new InvalidTransitionError("playbookChanged", item.state);
  const t = apply(
    { name: "playbookChanged", from: ["ready"], to: "ready", actor: "user", event: "item.playbook_changed" },
    item,
    ctx,
    undefined,
    { from: item.playbook, to: playbook },
  );
  if (!allowed.includes(playbook)) throw new PlaybookNotAllowedError(playbook, item.source);
  return { ...t, item: { ...t.item, playbook } };
}
