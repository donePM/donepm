export type TranscriptKind =
  | "user"
  | "assistant_text"
  | "assistant_thinking"
  | "tool_use"
  | "tool_result"
  | "result"
  /** Written by the daemon, not the CLI: worktree setup output (spec 7.3). */
  | "system"
  | "raw";

export interface TranscriptMessage {
  id: string;
  itemId: string;
  /** Claude `session_id`; empty for messages written before the session exists (setup). */
  sessionId: string;
  at: string;
  kind: TranscriptKind;
  /** The full stream-json line. Always kept. */
  raw: unknown;
}
