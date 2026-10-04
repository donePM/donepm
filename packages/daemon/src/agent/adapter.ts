import type { AgentCapabilities, AgentEvent, AgentKind, Answers, PermissionRule, Playbook, TranscriptKind } from "@donepm/core";
import { claudeCode } from "./claude/adapter.js";

/**
 * donePM's MCP server for one process (spec 10): a stdio command the agent starts. Its token lets the
 * agent create drafts for this item only. `dir` is the daemon's own (mode 0700), for a config file.
 */
export interface McpServer {
  command: string;
  args: string[];
  env: Record<string, string>;
  dir: string;
}

export interface AdapterLaunch {
  itemId: string;
  playbook: Pick<Playbook, "model" | "effort" | "permissionMode" | "readOnly">;
  resumeSessionId?: string;
  /** The agent's home, for writable cache directories. */
  home?: string;
  mcp?: McpServer;
}

/** A line for the agent's stdin. `record`: what the transcript keeps of it, if anything. */
export interface AgentWrite {
  type: "write";
  line: string;
  record?: { kind: TranscriptKind; raw: unknown };
}

/** What a connection asks the runner to do: act on an event, or write to the agent. */
export type AgentStep = AgentEvent | AgentWrite;

/** The answer to an ask, before the adapter puts it in its own words. */
export type AskReply =
  | {
      behavior: "allow";
      /** Rules to grant for the rest of the run; only from an agent with `sessionRules`. */
      rules?: readonly PermissionRule[];
      /** The user's answers to a question ask. */
      answers?: Answers;
    }
  | { behavior: "deny"; message: string; interrupt?: boolean };

/** The ask being answered, as the adapter handed it over. */
export interface AskRef {
  requestId: string;
  toolName: string;
  input: unknown;
}

/**
 * One agent process, from the runner's side. Every method returns steps in order; a line the
 * connection does not understand becomes a `raw` event, never an error (spec 9.3).
 */
export interface AgentConnection {
  decode(line: string): AgentStep[];
  /** The first user message of the process: the task, or the resume prompt. */
  firstTurn(text: string): AgentStep[];
  /** A later user message, e.g. why a draft was rejected. */
  nextTurn(text: string): AgentStep[];
  answerAsk(ask: AskRef, reply: AskReply): AgentStep[];
}

/** A coding agent donePM can run (issue #136). */
export interface AgentAdapter {
  readonly kind: AgentKind;
  /** The program's name on `PATH` when no path was detected; also how messages to the user name it. */
  readonly command: string;
  readonly capabilities: AgentCapabilities;
  /** Arguments for one process. `cleanup` runs when it exits (a config file, say). */
  launch(input: AdapterLaunch): { args: string[]; cleanup?: () => void };
  connect(): AgentConnection;
}

const ADAPTERS: Record<AgentKind, AgentAdapter> = {
  "claude-code": claudeCode,
};

export function adapterFor(kind: AgentKind): AgentAdapter {
  return ADAPTERS[kind];
}
