import type { Ctx } from "../ids.js";
import type { Event, EventActor, EventType } from "../event/types.js";
import type { ItemState, WorkItem } from "./types.js";

export interface Transition {
  item: WorkItem;
  events: Event[];
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
  return { item: { ...item, state: spec.to, updatedAt: at }, events: [event] };
}

/** Ready (or failed, as retry) to running. Emits `agent.resumed` if a session already exists. */
export function start(item: WorkItem, ctx: Ctx): Transition {
  return apply(
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

/** The daemon executed an approved draft (spec 6.3). Item is done. `payload` holds the result. */
export function draftExecuted(
  item: WorkItem,
  ctx: Ctx,
  draftId: string,
  payload: Record<string, unknown> = {},
): Transition {
  return apply(
    { name: "draftExecuted", from: ["needs_you"], to: "done", actor: "system", event: "draft.executed" },
    item,
    ctx,
    draftId,
    payload,
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

const ALL_STATES: ItemState[] = ["ready", "running", "needs_you", "done", "failed"];

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
