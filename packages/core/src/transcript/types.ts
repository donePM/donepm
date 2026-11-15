import type { AgentKind } from "../agent/kind.js";

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
  /** The agent's session id; empty for messages written before the session exists (setup). */
  sessionId: string;
  at: string;
  kind: TranscriptKind;
  /**
   * The agent whose line this is, in its own protocol (issue #136). Absent: written by the daemon
   * (setup), or by Claude Code before agents had a kind.
   */
  agentKind?: AgentKind;
  /** The agent's full line, as it sent it. Always kept. */
  raw: unknown;
}
