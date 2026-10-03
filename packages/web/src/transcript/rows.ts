import {
  askAgentId,
  isSubagentTool,
  parentToolUseId,
  subagentReport,
  subagentStatus,
  subagentTotals,
  taskEvent,
  type SubagentStatus,
} from "@donepm/core/subagent";
import { toolSummary } from "@donepm/core/tool-summary";
import { diffLines } from "diff";
import type { TranscriptMessage } from "../api/types";
import { clock } from "../time/duration";

export interface DiffLine {
  op: "+" | "-" | " ";
  text: string;
}

export interface ToolResult {
  text: string;
  isError: boolean;
}

/** One block in the Agents view. Built from stored transcript messages by `toRows`. */
export type Row =
  /** The first message: the rendered playbook. */
  | { type: "task"; id: string; text: string }
  /** A later message from the user. */
  | { type: "user"; id: string; text: string }
  /** Worktree setup step written by the daemon (spec 7.3). */
  | { type: "setup"; id: string; label: string; ok: boolean; output: string }
  | { type: "thinking"; id: string; text: string }
  | { type: "text"; id: string; text: string }
  /** A tool call and, once it arrived, its result. No result means it is still running. */
  | { type: "tool"; id: string; at: string; name: string; summary: string; input: unknown; diff?: DiffLine[]; result?: ToolResult }
  /**
   * A subagent: the `Agent` call, what it is doing, and the rows of its own messages. `result` is
   * its report once it handed back.
   */
  | {
      type: "agent";
      id: string;
      at: string;
      description: string;
      agentType?: string;
      model?: string;
      background: boolean;
      status: SubagentStatus;
      activity?: string;
      toolUses?: number;
      durationMs?: number;
      result?: ToolResult;
      children: Row[];
    }
  /** The agent asked for permission. */
  | { type: "ask"; id: string; name: string; summary: string }
  /** The end of a turn. */
  | { type: "result"; id: string; ok: boolean; label: string };

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Diffs longer than this are cut; the agent's full input stays in the raw message. */
export const MAX_DIFF_LINES = 400;

function blocks(raw: unknown): Json[] {
  const content = isObject(raw) && isObject(raw.message) ? raw.message.content : undefined;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content.filter(isObject) : [];
}

function textOf(raw: unknown): string {
  return blocks(raw)
    .map((b) => (typeof b.text === "string" ? b.text : ""))
    .join("");
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(isObject)
    .map((b) => (typeof b.text === "string" ? b.text : b.type === "image" ? "[image]" : ""))
    .join("\n");
}

function linesOf(value: string): string[] {
  const lines = value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function diffOf(oldText: string, newText: string): DiffLine[] {
  return diffLines(oldText, newText).flatMap((part) =>
    linesOf(part.value).map((text) => ({ op: part.added ? "+" : part.removed ? "-" : " ", text }) as DiffLine),
  );
}

/** The change an editing tool makes, as diff lines. Undefined for other tools. */
export function toolDiff(name: string, input: unknown): DiffLine[] | undefined {
  if (!isObject(input)) return undefined;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  let lines: DiffLine[] | undefined;
  if (name === "Edit") lines = diffOf(str(input.old_string), str(input.new_string));
  else if (name === "MultiEdit" && Array.isArray(input.edits)) {
    lines = input.edits.filter(isObject).flatMap((e, i) => [
      ...(i > 0 ? [{ op: " ", text: "…" } as DiffLine] : []),
      ...diffOf(str(e.old_string), str(e.new_string)),
    ]);
  } else if (name === "Write") lines = linesOf(str(input.content)).map((text) => ({ op: "+", text }));
  return lines?.slice(0, MAX_DIFF_LINES);
}

function setupRow(m: TranscriptMessage): Row {
  const raw = isObject(m.raw) ? m.raw : {};
  const ok = raw.ok === true;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const label =
    raw.step === "copy" ? `copy ${str(raw.file)}` : raw.step === "run" ? `run ${str(raw.command)}` : "read .donepm/setup.yml";
  const output = [str(raw.stdout), str(raw.stderr), str(raw.error)].filter((s) => s.trim() !== "").join("\n");
  return { type: "setup", id: m.id, label, ok, output };
}

function resultRow(m: TranscriptMessage): Row {
  const raw = isObject(m.raw) ? m.raw : {};
  const ok = raw.is_error !== true;
  const parts = [ok ? "Turn ended" : `Turn failed${typeof raw.subtype === "string" ? ` (${raw.subtype})` : ""}`];
  if (typeof raw.num_turns === "number") parts.push(`${raw.num_turns} steps`);
  if (typeof raw.total_cost_usd === "number") parts.push(`$${raw.total_cost_usd.toFixed(2)}`);
  return { type: "result", id: m.id, ok, label: parts.join(" · ") };
}

type AgentRow = Extract<Row, { type: "agent" }>;
type ToolRow = Extract<Row, { type: "tool" }>;

/** Where rows go: the main flow, or the rows of one subagent. */
interface Flow {
  rows: Row[];
  sawUser: boolean;
}

function agentRow(id: string, at: string, input: unknown): AgentRow {
  const i = isObject(input) ? input : {};
  return {
    type: "agent",
    id,
    at,
    description: typeof i.description === "string" ? i.description : "Subagent",
    agentType: typeof i.subagent_type === "string" ? i.subagent_type : undefined,
    model: typeof i.model === "string" ? i.model : undefined,
    background: i.run_in_background === true,
    status: "running",
    children: [],
  };
}

/** A foreground subagent is done when its result arrives; a background one only when its task ends. */
function finishAgent(agent: AgentRow, m: TranscriptMessage, text: string, isError: boolean): void {
  const totals = subagentTotals(m.raw);
  agent.result = { text: subagentReport(text), isError };
  if (totals.model) agent.model = totals.model;
  if (totals.durationMs !== undefined) agent.durationMs = totals.durationMs;
  if (totals.toolUses !== undefined) agent.toolUses = totals.toolUses;
  if (isError) agent.status = "failed";
  else if (!agent.background) agent.status = totals.status === undefined ? "done" : endStatus(totals.status);
}

/** A task that ended with a status donePM does not know still ended. */
const endStatus = (status: string | undefined): SubagentStatus =>
  subagentStatus(status) === "running" ? "done" : subagentStatus(status);

/**
 * Turn stored messages into what the Agents view shows. Tool results are joined to their call;
 * a subagent's messages go under its `Agent` call; messages it does not know (raw, init, answers)
 * are left out, never an error.
 */
export function toRows(messages: readonly TranscriptMessage[]): Row[] {
  const main: Flow = { rows: [], sawUser: false };
  const tools = new Map<string, ToolRow>();
  const agents = new Map<string, { row: AgentRow; flow: Flow }>();
  /** task id → `Agent` call, for lines that only carry the task id. */
  const tasks = new Map<string, string>();

  const flowOf = (m: TranscriptMessage): Flow => {
    const parent = parentToolUseId(m.raw);
    return (parent && agents.get(parent)?.flow) || main;
  };

  for (const m of messages) {
    switch (m.kind) {
      case "user": {
        const flow = flowOf(m);
        flow.rows.push({ type: flow.sawUser ? "user" : "task", id: m.id, text: textOf(m.raw) });
        flow.sawUser = true;
        break;
      }
      case "system":
        main.rows.push(setupRow(m));
        break;
      case "assistant_thinking": {
        const b = blocks(m.raw)[0];
        flowOf(m).rows.push({ type: "thinking", id: m.id, text: typeof b?.thinking === "string" ? b.thinking : "" });
        break;
      }
      case "assistant_text":
        flowOf(m).rows.push({ type: "text", id: m.id, text: textOf(m.raw) });
        break;
      case "tool_use": {
        const flow = flowOf(m);
        for (const b of blocks(m.raw)) {
          if (b.type !== "tool_use" || typeof b.name !== "string") continue;
          const id = typeof b.id === "string" ? b.id : m.id;
          if (isSubagentTool(b.name)) {
            const row = agentRow(id, m.at, b.input);
            agents.set(id, { row, flow: { rows: row.children, sawUser: false } });
            flow.rows.push(row);
            continue;
          }
          const row: ToolRow = {
            type: "tool", id, at: m.at, name: b.name, summary: toolSummary(b.name, b.input), input: b.input,
          };
          const diff = toolDiff(b.name, b.input);
          if (diff) row.diff = diff;
          tools.set(id, row);
          flow.rows.push(row);
        }
        break;
      }
      case "tool_result":
        for (const b of blocks(m.raw)) {
          if (b.type !== "tool_result" || typeof b.tool_use_id !== "string") continue;
          const text = resultText(b.content);
          const isError = b.is_error === true;
          const agent = agents.get(b.tool_use_id)?.row;
          if (agent) finishAgent(agent, m, text, isError);
          const call = tools.get(b.tool_use_id);
          if (call) call.result = { text, isError };
        }
        break;
      case "result":
        main.rows.push(resultRow(m));
        break;
      case "raw": {
        const raw = isObject(m.raw) ? m.raw : {};
        const req = raw.type === "control_request" && isObject(raw.request) ? raw.request : undefined;
        if (req?.subtype === "can_use_tool" && typeof req.tool_name === "string") {
          const task = askAgentId(raw);
          const call = task ? tasks.get(task) : undefined;
          const flow = (call && agents.get(call)?.flow) || main;
          flow.rows.push({ type: "ask", id: m.id, name: req.tool_name, summary: toolSummary(req.tool_name, req.input) });
          break;
        }
        const e = taskEvent(raw);
        if (!e) break;
        if (e.type === "started") tasks.set(e.taskId, e.toolUseId);
        const call = e.type === "updated" ? tasks.get(e.taskId) : (e.toolUseId ?? tasks.get(e.taskId));
        const agent = call ? agents.get(call)?.row : undefined;
        if (!agent) break;
        if (e.type === "started") {
          agent.background = e.background;
          if (e.agentType) agent.agentType = e.agentType;
        } else if (e.type === "progress") {
          agent.activity = e.activity;
          if (e.toolUses !== undefined) agent.toolUses = e.toolUses;
          if (e.durationMs !== undefined) agent.durationMs = e.durationMs;
        } else if (e.status) {
          const status = e.type === "notification" ? endStatus(e.status) : subagentStatus(e.status);
          if (status !== "running") agent.status = status;
          // A background subagent's report comes with its notification, not with its tool result.
          if (e.type === "notification" && agent.background && e.summary) {
            agent.result = { text: e.summary, isError: status === "failed" };
          }
        }
        break;
      }
    }
  }
  return main.rows;
}

/**
 * The note on a subagent's line: what it does now and for how long while it runs, its totals once
 * it ended. A subagent still marked running after the agent stopped shows as "stopped".
 */
export function agentNote(row: AgentRow, agentRunning: boolean, now: number): string {
  const tools = row.toolUses ? `${row.toolUses} tool${row.toolUses === 1 ? "" : "s"}` : "";
  const took = row.durationMs !== undefined ? clock(row.durationMs) : "";
  if (row.status === "running") {
    if (!agentRunning) return "stopped";
    return [row.activity ?? "running", clock(now - Date.parse(row.at))].join(" · ");
  }
  return [row.status === "failed" ? "failed" : "done", tools, took].filter(Boolean).join(" · ");
}

/** A short note for a finished tool: line count, or the first line of an error. */
export function resultNote(result: ToolResult): string {
  const lines = linesOf(result.text);
  if (result.isError) return "error";
  if (lines.length === 0) return "done";
  if (lines.length === 1) return lines[0]!.length > 40 ? `${lines[0]!.slice(0, 39)}…` : lines[0]!;
  return `${lines.length} lines`;
}

/**
 * Live typing: add one `stream_event` to the text so far. Only text deltas count; a new message
 * starts the text over.
 */
export function applyDelta(text: string, event: unknown): string {
  if (!isObject(event)) return text;
  if (event.type === "message_start") return "";
  if (event.type === "content_block_delta" && isObject(event.delta) && event.delta.type === "text_delta") {
    return text + (typeof event.delta.text === "string" ? event.delta.text : "");
  }
  return text;
}
