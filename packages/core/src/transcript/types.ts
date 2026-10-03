export type TranscriptKind =
  | "user"
  | "assistant_text"
  | "assistant_thinking"
  | "tool_use"
  | "tool_result"
  | "result"
  | "raw";

export interface TranscriptMessage {
  id: string;
  itemId: string;
  sessionId: string;
  at: string;
  kind: TranscriptKind;
  /** The full stream-json line. Always kept. */
  raw: unknown;
}
