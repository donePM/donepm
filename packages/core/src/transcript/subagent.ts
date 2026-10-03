/**
 * Claude Code's subagents in stream-json (spec 9.3). A subagent starts with a tool call named
 * `Agent` (`Task` in older CLIs). Every message the subagent produces carries the id of that call
 * as `parent_tool_use_id`; its permission asks carry the task id as `request.agent_id`; its
 * lifecycle comes as `system/task_*` lines. Everything here reads stored raw lines and never throws.
 */

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Tool names that start a subagent. */
export const SUBAGENT_TOOLS: readonly string[] = ["Agent", "Task"];

export function isSubagentTool(name: string): boolean {
  return SUBAGENT_TOOLS.includes(name);
}

/** The `Agent` call a message belongs to. Undefined for the main agent's own messages. */
export function parentToolUseId(raw: unknown): string | undefined {
  return isObject(raw) ? str(raw.parent_tool_use_id) : undefined;
}

/** The task id of a subagent's permission ask (`control_request.request.agent_id`). */
export function askAgentId(raw: unknown): string | undefined {
  return isObject(raw) && isObject(raw.request) ? str(raw.request.agent_id) : undefined;
}

export type SubagentStatus = "running" | "done" | "failed";

/** How a task status from the CLI reads in donePM. Unknown statuses count as still running. */
export function subagentStatus(status: string | undefined): SubagentStatus {
  switch (status) {
    case "completed":
      return "done";
    case "failed":
    case "killed":
    case "stopped":
    case "cancelled":
      return "failed";
    default:
      return "running";
  }
}

export type TaskEvent =
  /** The subagent started. `toolUseId` is the `Agent` call. */
  | { type: "started"; taskId: string; toolUseId: string; description?: string; agentType?: string; background: boolean }
  /** What the subagent is doing now, with its running totals. */
  | { type: "progress"; taskId: string; toolUseId: string; activity?: string; toolUses?: number; durationMs?: number }
  /** A status change. Carries no tool use id, only the task id. */
  | { type: "updated"; taskId: string; status?: string }
  /** The task ended. Also sent for background Bash tasks, which have no `Agent` call. */
  | { type: "notification"; taskId: string; toolUseId?: string; status?: string; summary?: string };

/** Decode a `system/task_*` line. Undefined for anything else, including unknown task subtypes. */
export function taskEvent(raw: unknown): TaskEvent | undefined {
  if (!isObject(raw) || raw.type !== "system") return undefined;
  const taskId = str(raw.task_id);
  if (!taskId) return undefined;
  const toolUseId = str(raw.tool_use_id);
  switch (raw.subtype) {
    case "task_started":
      if (!toolUseId) return undefined;
      return {
        type: "started",
        taskId,
        toolUseId,
        description: str(raw.description),
        agentType: str(raw.subagent_type),
        background: raw.is_backgrounded === true,
      };
    case "task_progress": {
      if (!toolUseId) return undefined;
      const usage = isObject(raw.usage) ? raw.usage : {};
      return {
        type: "progress",
        taskId,
        toolUseId,
        activity: str(raw.description),
        toolUses: num(usage.tool_uses),
        durationMs: num(usage.duration_ms),
      };
    }
    case "task_updated": {
      const patch = isObject(raw.patch) ? raw.patch : {};
      return { type: "updated", taskId, status: str(patch.status) };
    }
    case "task_notification":
      return { type: "notification", taskId, toolUseId, status: str(raw.status), summary: str(raw.summary) };
    default:
      return undefined;
  }
}

/** Totals the CLI attaches to the `Agent` tool result (`tool_use_result`). */
export interface SubagentTotals {
  status?: string;
  durationMs?: number;
  toolUses?: number;
  model?: string;
}

export function subagentTotals(raw: unknown): SubagentTotals {
  const r = isObject(raw) && isObject(raw.tool_use_result) ? raw.tool_use_result : {};
  return {
    status: str(r.status),
    durationMs: num(r.totalDurationMs),
    toolUses: num(r.totalToolUseCount),
    model: str(r.resolvedModel),
  };
}

const HAND_BACK = "[Subagent hand-back]";
const REPORT_FOLLOWS = "The report follows:\n";

/**
 * The subagent's report without the frame the harness wraps around it: the hand-back note above
 * it and the two spaces it indents every line with. Text without the frame comes back as it is.
 */
export function subagentReport(text: string): string {
  if (!text.startsWith(HAND_BACK)) return text;
  const at = text.indexOf(REPORT_FOLLOWS);
  if (at < 0) return text;
  return text
    .slice(at + REPORT_FOLLOWS.length)
    .split("\n")
    .map((line) => (line.startsWith("  ") ? line.slice(2) : line))
    .join("\n");
}
