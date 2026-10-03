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
  const t = apply(
    { name: "worktreeRemoved", from: ["done", "failed"], to: item.state, actor: "user", event: "worktree.removed" },
    item,
    ctx,
    undefined,
    payload,
  );
  const { worktreePath: _path, agentSessionId: _session, ...rest } = t.item;
  return { ...t, item: rest };
}
