import type { AskFlags } from "../ask/session-rules.js";
import type { PermissionRule } from "../ask/rules.js";
import type { AskSubject } from "../ask/subject.js";
import type { TranscriptKind } from "../transcript/types.js";
import type { TokenUsage } from "./usage.js";

/**
 * Claude Code's rule grammar on an ask (D30, D38). Only an agent with rules sends it; without it
 * "Allow for this run" grants nothing and "Always allow" is not offered.
 */
export interface AskRules {
  /** Rules "Allow for this run" may grant: the asked tool's own, none when the agent says so. */
  offered: PermissionRule[];
  /** Everything the agent suggested, for matching "Always allow" grants. */
  suggested: PermissionRule[];
  flags: AskFlags;
}

/** A permission question as an adapter hands it to the runner. */
export interface AgentAsk {
  /** The agent's id for the question; its answer must carry it. */
  requestId: string;
  /** The agent's own name for what it wants to do (`Bash`, `WebFetch`), kept for the record. */
  toolName: string;
  /** The agent's own input, kept as sent: the adapter needs it to answer. */
  input: unknown;
  subject: AskSubject;
  /** Why the agent asks, as it said it; may carry ANSI codes. */
  reason?: string;
  rules?: AskRules;
  /**
   * The host of a plain read of one URL, which the daemon may allow itself when the host is on the
   * user's list (D31). Not set for other network asks: those would open the host to commands too.
   */
  fetchHost?: string;
}

/**
 * What a coding agent said, in the words the runner acts on (issue #136). Each adapter maps its own
 * protocol onto these; a line it does not know becomes `raw`, never an error.
 */
export type AgentEvent =
  /** The agent's session id is known; it is what a resume needs, so it is stored at once. */
  | { type: "session_bound"; sessionId: string }
  /** The agent started a turn (possibly on its own, after the previous one ended). */
  | { type: "turn_started" }
  /** A transcript row. `refId` names the agent's own id for it, for agents that update a row in place. */
  | { type: "message"; kind: TranscriptKind; raw: unknown; refId?: string }
  /** A line kept in the transcript that donePM does not interpret. */
  | { type: "raw"; raw: unknown }
  /** Live typing; pushed to the UI, never stored. */
  | { type: "live"; event: unknown }
  /** A tool call started; the board shows the latest one still running. */
  | { type: "tool_started"; id: string; name: string; summary: string }
  /** A tool call has its result. */
  | { type: "tool_finished"; id: string }
  /** The agent holds the turn until the question is answered. */
  | { type: "ask"; ask: AgentAsk }
  /** Usage of the process so far. `costUsd` only from an agent that reports a price. */
  | { type: "usage"; usage?: TokenUsage; costUsd?: number }
  /** The turn ended. `interrupted`: stopped on request, which is not an error. `detail` is the agent's own word for how. */
  | { type: "turn_ended"; isError: boolean; interrupted: boolean; detail?: string }
  /** Not a line of the protocol at all, e.g. cut off by a crash. Skipped. */
  | { type: "malformed"; line: string };

/** Events that put a row in the transcript. */
export function isStored(e: AgentEvent): e is Extract<AgentEvent, { type: "message" | "raw" }> {
  return e.type === "message" || e.type === "raw";
}

/** The transcript kind of a stored event. */
export function storedKind(e: Extract<AgentEvent, { type: "message" | "raw" }>): TranscriptKind {
  return e.type === "raw" ? "raw" : e.kind;
}
