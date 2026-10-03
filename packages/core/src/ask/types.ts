export type PermissionAskState = "pending" | "allowed" | "denied";

export interface PermissionAsk {
  id: string;
  itemId: string;
  /** `request_id` from the CLI. */
  requestId: string;
  toolName: string;
  input: unknown;
  state: PermissionAskState;
}
