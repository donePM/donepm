export type DraftType = "pr";
export type DraftState = "pending" | "approved" | "rejected" | "executed" | "failed";

export interface PrDraftPayload {
  title: string;
  body: string;
  base: string;
}

export interface PrDraftResult {
  url: string;
  number: number;
}

export interface Draft {
  id: string;
  itemId: string;
  type: DraftType;
  payload: PrDraftPayload;
  state: DraftState;
  /** The payload after user edits. */
  userEdits?: PrDraftPayload;
  result?: PrDraftResult;
}
