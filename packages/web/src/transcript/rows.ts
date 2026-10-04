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
import { resultNote as coreResultNote, stepSummary, todosOf, toolSummary } from "@donepm/core/tool-summary";
import { diffLines } from "diff";
import type { PermissionAsk, TranscriptMessage } from "../api/types";
import { clock } from "../time/duration";

export interface DiffLine {
  op: "+" | "-" | " ";
  text: string;
}

export interface ToolResult {
  text: string;
  isError: boolean;
  /** When it arrived. Missing for subagent reports from a task notification. */
  at?: string;
}

export interface Todo {
  content: string;
  status: string;
}

/** Lines an edit adds and removes. */
export interface DiffStat {
  added: number;
  removed: number;
}

/**
 * A tool call and, once it arrived, its result. No result means it is still running. `summary` is
 * the headline; `command` is the full Bash command when the headline does not show all of it.
 */
export interface ToolRow {
  type: "tool";
  id: string;
  at: string;
  name: string;
  summary: string;
  input: unknown;
  command?: string;
  diff?: DiffLine[];
  diffStat?: DiffStat;
  todos?: Todo[];
  result?: ToolResult;
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
  | ToolRow
  /** Consecutive read-only calls (Read, Grep, Glob), shown as one line that expands. */
  | { type: "group"; id: string; label: string; summary: string; children: ToolRow[] }
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
  /**
   * The agent asked for permission. `ask` is the stored question while it waits for an answer;
   * `outcome` is how it ended, unknown for asks from before donePM kept them.
   */
  | { type: "ask"; id: string; name: string; summary: string; input: unknown; reason?: string; ask?: PermissionAsk; outcome?: AskOutcome; outcomeReason?: string }
  /** The end of a turn. */
  | { type: "result"; id: string; ok: boolean; label: string };

export type AskOutcome = "pending" | "allowed" | "allowed_run" | "denied" | "expired";

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
    raw.step === "copy" ? `copy ${str(raw.file)}`
    : raw.step === "run" ? `run ${str(raw.command)}`
    : raw.step === "dependencies" ? dependenciesLabel(raw, str)
    : "read .donepm/setup.yml";
  const reason = raw.step === "dependencies" && raw.method === "install" ? str(raw.reason) : "";
  const output = [reason && `(${reason})`, str(raw.stdout), str(raw.stderr), str(raw.error)]
    .filter((s) => s.trim() !== "")
    .join("\n");
  return { type: "setup", id: m.id, label, ok, output };
}

/** D34: dependencies cloned from the main clone, or installed by the daemon. */
function dependenciesLabel(raw: Record<string, unknown>, str: (v: unknown) => string): string {
  if (raw.method === "install") return `run ${str(raw.command)}`;
  const dirs = Array.isArray(raw.dirs) ? raw.dirs.filter((d): d is string => typeof d === "string") : [];
  return `copy ${dirs.join(", ") || "dependencies"} from the main clone (${str(raw.manager)})`;
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
type GroupRow = Extract<Row, { type: "group" }>;

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

type AskRow = Extract<Row, { type: "ask" }>;

/** The answers donePM wrote to the agent, by request id; the transcript keeps them as raw lines. */
function answersOf(messages: readonly TranscriptMessage[]): Map<string, AskOutcome> {
  const out = new Map<string, AskOutcome>();
  for (const m of messages) {
    if (m.kind !== "raw" || !isObject(m.raw) || m.raw.type !== "control_response" || !isObject(m.raw.response)) continue;
    const { request_id: id, response } = m.raw.response;
    if (typeof id !== "string" || !isObject(response)) continue;
    if (response.behavior === "deny") out.set(id, "denied");
    else if (response.behavior === "allow") out.set(id, Array.isArray(response.updatedPermissions) ? "allowed_run" : "allowed");
  }
  return out;
}

/** A subagent waits on the user when one of its asks, or its own subagents' asks, is pending. */
export function hasPendingAsk(row: Row): boolean {
  if (row.type === "ask") return row.ask !== undefined;
  return row.type === "agent" && row.children.some(hasPendingAsk);
}

/** How an ask ended, in words. Questions are answered or declined, not allowed. */
export function askOutcomeText(row: AskRow): string {
  const text = outcomeWord(row);
  return row.outcomeReason && text ? `${text}: ${row.outcomeReason}` : text;
}

function outcomeWord(row: AskRow): string {
  const question = row.name === "AskUserQuestion";
  switch (row.outcome) {
    case "pending":
      return "waiting for you";
    case "allowed":
      return question ? "answered" : "allowed";
    case "allowed_run":
      return "allowed for this run";
    case "denied":
      return question ? "declined" : "denied";
    case "expired":
      return "expired";
    default:
      return "";
  }
}

/** A task that ended with a status donePM does not know still ended. */
const endStatus = (status: string | undefined): SubagentStatus =>
  subagentStatus(status) === "running" ? "done" : subagentStatus(status);

/**
 * Turn stored messages into what the Agents view shows. Tool results are joined to their call;
 * a subagent's messages go under its `Agent` call; messages it does not know (raw, init, answers)
 * are left out, never an error.
 */
export function toRows(messages: readonly TranscriptMessage[], asks: readonly PermissionAsk[] = [], opts: { cwd?: string } = {}): Row[] {
  const { cwd } = opts;
  const main: Flow = { rows: [], sawUser: false };
  const answers = answersOf(messages);
  const stored = new Map(asks.map((a) => [a.requestId, a]));
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
            type: "tool", id, at: m.at, name: b.name, summary: stepSummary(b.name, b.input, cwd), input: b.input,
          };
          const command = fullCommand(b.name, b.input, row.summary);
          if (command) row.command = command;
          const diff = toolDiff(b.name, b.input);
          if (diff) {
            row.diff = diff;
            row.diffStat = diffStat(diff);
          }
          if (b.name === "TodoWrite") row.todos = todosOf(b.input).map(({ content, status }) => ({ content, status }));
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
          if (call) call.result = { text, isError, at: m.at };
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
          const requestId = typeof raw.request_id === "string" ? raw.request_id : undefined;
          const ask = requestId ? stored.get(requestId) : undefined;
          const outcome = (requestId && answers.get(requestId)) || ask?.state;
          const row: AskRow = {
            type: "ask", id: m.id, name: req.tool_name, summary: toolSummary(req.tool_name, req.input, cwd), input: req.input,
          };
          if (typeof req.decision_reason === "string") row.reason = req.decision_reason;
          if (ask?.state === "pending" && outcome === "pending") row.ask = ask;
          if (outcome) row.outcome = outcome;
          if (ask?.outcomeReason) row.outcomeReason = ask.outcomeReason;
          flow.rows.push(row);
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
  return groupReads(main.rows);
}

/** Calls that only look: several in a row read as one line. */
const READ_ONLY = new Set(["Read", "Grep", "Glob"]);

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

function groupRow(children: ToolRow[]): GroupRow {
  const reads = children.filter((c) => c.name === "Read");
  const files = new Set(reads.map((r) => r.summary.replace(/:\d+-\d*$/, ""))).size;
  const searches = children.length - reads.length;
  const label = [reads.length ? `read ${plural(files, "file")}` : "", searches ? plural(searches, "search", "searches") : ""]
    .filter(Boolean)
    .join(", ");
  return {
    type: "group",
    id: `group:${children[0]!.id}`,
    label: label.charAt(0).toUpperCase() + label.slice(1),
    summary: children.map((c) => (c.name === "Read" ? (c.summary.split("/").at(-1) ?? c.summary) : c.summary)).join(", "),
    children,
  };
}

/** Collapse runs of two or more read-only calls into a group, here and inside subagents. */
export function groupReads(rows: Row[]): Row[] {
  const out: Row[] = [];
  let run: ToolRow[] = [];
  const flush = () => {
    if (run.length > 1) out.push(groupRow(run));
    else out.push(...run);
    run = [];
  };
  for (const row of rows) {
    if (row.type === "tool" && READ_ONLY.has(row.name)) {
      run.push(row);
      continue;
    }
    flush();
    if (row.type === "agent") row.children = groupReads(row.children);
    out.push(row);
  }
  flush();
  return out;
}

/** The latest tool call in these rows, looking into groups. */
export function lastTool(rows: readonly Row[]): ToolRow | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]!;
    if (r.type === "tool") return r;
    if (r.type === "group") return r.children.at(-1);
  }
  return undefined;
}

/** The full Bash command, when the headline is its description or leaves parts of it out. */
function fullCommand(name: string, input: unknown, summary: string): string | undefined {
  if (name !== "Bash" || !isObject(input) || typeof input.command !== "string") return undefined;
  const command = input.command.trim();
  return command && command !== summary ? command : undefined;
}

export function diffStat(lines: readonly DiffLine[]): DiffStat {
  return {
    added: lines.filter((l) => l.op === "+").length,
    removed: lines.filter((l) => l.op === "-").length,
  };
}

/** The first lines of a diff to show without opening the step: from just before the first change. */
export function diffPreview(lines: readonly DiffLine[], max = 6): DiffLine[] {
  const first = lines.findIndex((l) => l.op !== " ");
  const start = Math.max(0, first - 1);
  return lines.slice(start, start + max);
}

/** The last lines of a failed command's output. */
export function outputTail(text: string, max = 6): string {
  return linesOf(text.trimEnd()).slice(-max).join("\n");
}

/** The first lines of a command, and whether there is more. */
export function commandPreview(command: string, max = 3): { text: string; more: boolean } {
  const lines = command.split("\n");
  return { text: lines.slice(0, max).join("\n"), more: lines.length > max };
}

/** When a step started and how long it took, for the tooltip. */
export function stepTime(row: ToolRow): string {
  const start = Date.parse(row.at);
  if (Number.isNaN(start)) return "";
  const time = new Date(start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const end = row.result?.at ? Date.parse(row.result.at) : NaN;
  return Number.isNaN(end) ? time : `${time} · took ${clock(end - start)}`;
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

/**
 * The note on the right of a finished step: exit status, test counts, lines. An edit shows the
 * lines it adds and removes instead, a todo list nothing.
 */
export function resultNote(row: Pick<ToolRow, "name" | "result" | "diffStat">): string {
  if (!row.result) return "";
  if (!row.result.isError && row.diffStat) return `+${row.diffStat.added} −${row.diffStat.removed}`;
  if (!row.result.isError && row.name === "TodoWrite") return "";
  return coreResultNote(row.name, row.result.text, row.result.isError);
}

/** A group's note: running, or how many of its calls failed. */
export function groupNote(row: GroupRow): string {
  const failed = row.children.filter((c) => c.result?.isError).length;
  return failed ? plural(failed, "error") : "";
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
