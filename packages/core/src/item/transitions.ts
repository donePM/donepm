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

/** User approved the draft; the daemon executes it. Item is done. */
export function draftApproved(item: WorkItem, ctx: Ctx, draftId: string): Transition {
  return apply(
    { name: "draftApproved", from: ["needs_you"], to: "done", actor: "user", event: "draft.approved" },
    item,
    ctx,
    draftId,
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
