import { toolSummary } from "@donepm/core/tool-summary";
import { diffLines } from "diff";
import type { TranscriptMessage } from "../api/types";

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

/**
 * Turn stored messages into what the Agents view shows. Tool results are joined to their call;
 * messages it does not know (raw, init, answers) are left out, never an error.
 */
export function toRows(messages: readonly TranscriptMessage[]): Row[] {
  const rows: Row[] = [];
  const tools = new Map<string, Extract<Row, { type: "tool" }>>();
  let sawUser = false;

  for (const m of messages) {
    switch (m.kind) {
      case "user": {
        const text = textOf(m.raw);
        rows.push({ type: sawUser ? "user" : "task", id: m.id, text });
        sawUser = true;
        break;
      }
      case "system":
        rows.push(setupRow(m));
        break;
      case "assistant_thinking": {
        const b = blocks(m.raw)[0];
        rows.push({ type: "thinking", id: m.id, text: typeof b?.thinking === "string" ? b.thinking : "" });
        break;
      }
      case "assistant_text":
        rows.push({ type: "text", id: m.id, text: textOf(m.raw) });
        break;
      case "tool_use":
        for (const b of blocks(m.raw)) {
          if (b.type !== "tool_use" || typeof b.name !== "string") continue;
          const id = typeof b.id === "string" ? b.id : m.id;
          const row: Extract<Row, { type: "tool" }> = {
            type: "tool", id, at: m.at, name: b.name, summary: toolSummary(b.name, b.input), input: b.input,
          };
          const diff = toolDiff(b.name, b.input);
          if (diff) row.diff = diff;
          tools.set(id, row);
          rows.push(row);
        }
        break;
      case "tool_result":
        for (const b of blocks(m.raw)) {
          if (b.type !== "tool_result" || typeof b.tool_use_id !== "string") continue;
          const call = tools.get(b.tool_use_id);
          if (call) call.result = { text: resultText(b.content), isError: b.is_error === true };
        }
        break;
      case "result":
        rows.push(resultRow(m));
        break;
      case "raw": {
        const raw = isObject(m.raw) ? m.raw : {};
        const req = raw.type === "control_request" && isObject(raw.request) ? raw.request : undefined;
        if (req?.subtype === "can_use_tool" && typeof req.tool_name === "string") {
          rows.push({ type: "ask", id: m.id, name: req.tool_name, summary: toolSummary(req.tool_name, req.input) });
        }
        break;
      }
    }
  }
  return rows;
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
