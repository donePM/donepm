export type EventActor = "user" | "agent" | "system";

export const EVENT_TYPES = [
  "item.collected",
  "item.playbook_changed",
  "agent.started",
  "agent.resumed",
  "agent.turn_ended",
  "agent.failed",
  "permission.asked",
  "permission.answered",
  "draft.created",
  "draft.edited",
  "draft.approved",
  "draft.rejected",
  "draft.executed",
  "draft.execution_failed",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** Append-only. Never updated or deleted. */
export interface Event {
  id: string;
  itemId: string;
  at: string;
  actor: EventActor;
  type: EventType;
  payload: Record<string, unknown>;
  /** Draft id, ask id or message id. */
  refId?: string;
}
