import {
  CODEX_ASK_METHODS,
  CODEX_USER_INPUT,
  codexDiff,
  codexRequestId,
  codexToolName,
  codexToolSummary,
  unwrapShell,
} from "@donepm/core";
import type { PermissionAsk, TranscriptMessage } from "../api/types";
import { MAX_DIFF_LINES, diffStat, type AskOutcome, type DiffLine, type Row, type ToolRow } from "./rows";

// Codex's stored lines (JSON-RPC frames, issue #137) as rows. Kept apart from Claude Code's: a Codex
// item arrives twice under one id (`item/started`, then `item/completed`) and is drawn once.

type Json = Record<string, unknown>;
type AskRow = Extract<Row, { type: "ask" }>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A unified diff's body lines; headers and hunk lines are left out. */
function diffLinesOf(unified: string): DiffLine[] {
  return unified
    .split("\n")
    .filter((l) => !/^(---|\+\+\+|@@)/.test(l))
    .map((l) => ({ op: l[0] === "+" || l[0] === "-" ? l[0] : " ", text: l.slice(1) }) as DiffLine)
    .slice(0, MAX_DIFF_LINES);
}

/** What the user sent, from donePM's own `turn/start` or `turn/steer`. */
function sentText(raw: unknown): string {
  const input = isObject(raw) && isObject(raw.params) && Array.isArray(raw.params.input) ? raw.params.input : [];
  return input.filter(isObject).map((b) => str(b.text)).join("\n");
}

/** How a finished item went, as a tool result. */
function itemResult(item: Json, at: string): ToolRow["result"] {
  const status = str(item.status);
  const exit = typeof item.exitCode === "number" ? item.exitCode : undefined;
  const error = isObject(item.error) ? str(item.error.message) : "";
  const isError = status === "failed" || status === "declined" || (exit !== undefined && exit !== 0) || error !== "";
  const text = str(item.aggregatedOutput) || error || (status === "declined" ? "declined" : "");
  return { text, isError, at };
}

function toolRow(item: Json, at: string, cwd: string | undefined): ToolRow {
  const name = codexToolName(item);
  const row: ToolRow = { type: "tool", id: str(item.id), at, name, summary: codexToolSummary(item, cwd), input: item };
  if (item.type === "commandExecution") {
    const command = unwrapShell(str(item.command)).trim();
    if (command && command !== row.summary) row.command = command;
  }
  if (item.type === "fileChange") {
    const diff = diffLinesOf(codexDiff(item, cwd));
    if (diff.length) {
      row.diff = diff;
      row.diffStat = diffStat(diff);
    }
  }
  return row;
}

/** donePM's answers to Codex's requests, by the server's request id. */
function answersOf(messages: readonly TranscriptMessage[]): Map<string, AskOutcome> {
  const out = new Map<string, AskOutcome>();
  for (const m of messages) {
    if (m.agentKind !== "codex" || !isObject(m.raw) || m.raw.method !== undefined || !isObject(m.raw.result)) continue;
    const decision = m.raw.result.decision;
    const id = String(m.raw.id);
    if (decision === "accept") out.set(id, "allowed");
    else if (decision === "acceptForSession") out.set(id, "allowed_run");
    else if (decision === "decline" || decision === "cancel") out.set(id, "denied");
    else if (isObject(m.raw.result.answers)) out.set(id, "allowed");
  }
  return out;
}

/**
 * Builds Codex rows into `rows`. `add` takes one stored line at a time, in order, so Codex and
 * daemon lines (setup) stay interleaved as they happened.
 */
export function codexPresenter(
  all: readonly TranscriptMessage[],
  asks: readonly PermissionAsk[],
  cwd: string | undefined,
) {
  const answers = answersOf(all);
  const stored = new Map(asks.filter((a) => a.agentKind === "codex").map((a) => [a.requestId, a]));
  const tools = new Map<string, ToolRow>();

  return (m: TranscriptMessage, flow: { rows: Row[]; sawUser: boolean }): void => {
    const raw = isObject(m.raw) ? m.raw : {};
    const params = isObject(raw.params) ? raw.params : {};
    const item = isObject(params.item) ? params.item : undefined;
    const method = str(raw.method);

    if (m.kind === "user") {
      flow.rows.push({ type: flow.sawUser ? "user" : "task", id: m.id, text: sentText(raw) });
      flow.sawUser = true;
      return;
    }
    if (item && (m.kind === "assistant_text" || m.kind === "assistant_thinking")) {
      // The text is whole only once the item completed; the live line shows it while it types.
      if (method !== "item/completed") return;
      if (m.kind === "assistant_text") flow.rows.push({ type: "text", id: m.id, text: str(item.text) });
      else {
        const parts = [...(Array.isArray(item.summary) ? item.summary : []), ...(Array.isArray(item.content) ? item.content : [])];
        const text = parts.map(str).filter(Boolean).join("\n");
        if (text) flow.rows.push({ type: "thinking", id: m.id, text });
      }
      return;
    }
    if (item && m.kind === "tool_use") {
      const id = str(item.id);
      const known = tools.get(id);
      const row = known ?? toolRow(item, m.at, cwd);
      if (!known) {
        tools.set(id, row);
        flow.rows.push(row);
      } else if (method === "item/completed") {
        // The completed item has the final command, changes and output.
        Object.assign(row, { ...toolRow(item, row.at, cwd), at: row.at });
      }
      if (method === "item/completed") row.result = itemResult(item, m.at);
      return;
    }
    if (m.kind !== "raw") return;
    if (CODEX_ASK_METHODS.includes(method) && raw.id !== undefined) {
      const serverId = raw.id as string | number;
      const ask = stored.get(codexRequestId(params, serverId));
      const outcome = answers.get(String(serverId)) ?? ask?.state;
      const call = tools.get(str(params.itemId));
      const row: AskRow = {
        type: "ask",
        id: m.id,
        name: method === CODEX_USER_INPUT ? "AskUserQuestion" : (call?.name ?? method),
        summary: call?.summary ?? str(params.reason),
        input: call?.input ?? params,
      };
      if (str(params.reason)) row.reason = str(params.reason);
      if (ask?.state === "pending" && (outcome === undefined || outcome === "pending")) row.ask = ask;
      if (outcome) row.outcome = outcome;
      if (ask?.outcomeReason) row.outcomeReason = ask.outcomeReason;
      flow.rows.push(row);
      return;
    }
    if (method === "turn/completed") {
      const turn = isObject(params.turn) ? params.turn : {};
      const status = str(turn.status);
      const label = status === "failed" ? "Turn failed" : status === "interrupted" ? "Turn stopped" : "Turn ended";
      flow.rows.push({ type: "result", id: m.id, ok: status !== "failed", label });
    }
  };
}

/** Live typing for Codex: an `item/agentMessage/delta` adds its text. */
export function applyCodexDelta(text: string, event: unknown): string | undefined {
  if (!isObject(event) || event.method !== "item/agentMessage/delta") return undefined;
  return text + (isObject(event.params) ? str(event.params.delta) : "");
}
