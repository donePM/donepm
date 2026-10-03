/** `expired`: the process that asked is gone (daemon restart); nobody can answer it any more. */
export type PermissionAskState = "pending" | "allowed" | "denied" | "expired";

export interface PermissionAsk {
  id: string;
  itemId: string;
  /** `request_id` from the CLI. */
  requestId: string;
  toolName: string;
  input: unknown;
  state: PermissionAskState;
}
