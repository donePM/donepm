import type { AgentKind } from "../agent/kind.js";
import type { PermissionRule } from "./rules.js";
import type { AskSubject } from "./subject.js";

/**
 * `expired`: the process that asked is gone (daemon restart); nobody can answer it any more.
 * `denied` by the system (Stop, shutdown) carries an `outcomeReason`.
 */
export type PermissionAskState = "pending" | "allowed" | "denied" | "expired";

export interface PermissionAsk {
  id: string;
  itemId: string;
  /** The agent that asked (issue #136); `requestId`, `toolName` and `input` are in its words. */
  agentKind: AgentKind;
  /** `request_id` from the CLI. */
  requestId: string;
  toolName: string;
  input: unknown;
  /** What the ask is about, in words no agent owns; the ask panel draws from it. */
  subject: AskSubject;
  state: PermissionAskState;
  /** Rules the CLI suggested and we may grant for the run, possibly none ("Allow for this run"). */
  rules: PermissionRule[];
  /** Why the CLI asks (`decision_reason`), as it sent it; may carry ANSI codes. */
  reason?: string;
  /** Why the ask ended without the user's answer (Stop, shutdown, restart). */
  outcomeReason?: string;
}
