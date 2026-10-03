import type { TranscriptKind } from "@donepm/core";
import { describe, expect, it } from "vitest";
import type { TranscriptMessage } from "../api/types";
import { applyDelta, resultNote, toolDiff, toRows } from "./rows";

let n = 0;
const msg = (kind: TranscriptKind, raw: unknown): TranscriptMessage => ({
  id: `m${++n}`, itemId: "i1", sessionId: "s1", at: "2026-10-03T12:00:00.000Z", kind, raw,
});
const user = (text: string) => msg("user", { type: "user", message: { role: "user", content: [{ type: "text", text }] } });
const assistant = (kind: TranscriptKind, block: object) =>
  msg(kind, { type: "assistant", message: { role: "assistant", content: [block] } });
const toolUse = (id: string, name: string, input: object) => assistant("tool_use", { type: "tool_use", id, name, input });
const toolResult = (id: string, content: unknown, isError = false) =>
  msg("tool_result", { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } });

describe("toRows", () => {
  it("makes the first user message the task and later ones user notes", () => {
    const rows = toRows([user("Do the thing"), user("Also this")]);
    expect(rows.map((r) => [r.type, "text" in r ? r.text : ""])).toEqual([
      ["task", "Do the thing"],
      ["user", "Also this"],
    ]);
  });

  it("shows text and thinking", () => {
    const rows = toRows([
      assistant("assistant_thinking", { type: "thinking", thinking: "hmm" }),
      assistant("assistant_text", { type: "text", text: "Reading the code." }),
    ]);
    expect(rows).toMatchObject([
      { type: "thinking", text: "hmm" },
      { type: "text", text: "Reading the code." },
    ]);
  });

  it("joins a tool result to its call; a call without one is running", () => {
    const rows = toRows([
      toolUse("t1", "Read", { file_path: "a.ts" }),
      toolUse("t2", "Bash", { command: "pnpm test" }),
      toolResult("t1", "1\thello\n2\tworld\n"),
    ]);
    expect(rows).toMatchObject([
      { type: "tool", id: "t1", name: "Read", summary: "a.ts", result: { text: "1\thello\n2\tworld\n", isError: false } },
      { type: "tool", id: "t2", name: "Bash", summary: "pnpm test" },
    ]);
    expect((rows[1] as { result?: unknown }).result).toBeUndefined();
  });

  it("reads results given as content blocks and flags errors", () => {
    const rows = toRows([toolUse("t1", "Bash", { command: "x" }), toolResult("t1", [{ type: "text", text: "boom" }], true)]);
    expect(rows[0]).toMatchObject({ result: { text: "boom", isError: true } });
  });

  it("gives Edit a diff", () => {
    const rows = toRows([toolUse("t1", "Edit", { file_path: "a.ts", old_string: "a\nb\n", new_string: "a\nc\n" })]);
    expect(rows[0]).toMatchObject({ diff: [{ op: " ", text: "a" }, { op: "-", text: "b" }, { op: "+", text: "c" }] });
  });

  it("shows setup steps with their output", () => {
    const rows = toRows([
      msg("system", { type: "donepm_setup", step: "copy", file: ".env", ok: true }),
      msg("system", { type: "donepm_setup", step: "run", command: "composer install", ok: false, code: 1, stdout: "", stderr: "no php" }),
    ]);
    expect(rows).toEqual([
      { type: "setup", id: expect.any(String), label: "copy .env", ok: true, output: "" },
      { type: "setup", id: expect.any(String), label: "run composer install", ok: false, output: "no php" },
    ]);
  });

  it("shows permission asks and turn results", () => {
    const rows = toRows([
      msg("raw", { type: "control_request", request_id: "r", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "curl x" } } }),
      msg("result", { type: "result", subtype: "success", is_error: false, num_turns: 3, total_cost_usd: 0.0297 }),
      msg("result", { type: "result", subtype: "error_max_turns", is_error: true }),
    ]);
    expect(rows).toMatchObject([
      { type: "ask", name: "Bash", summary: "curl x" },
      { type: "result", ok: true, label: "Turn ended · 3 steps · $0.03" },
      { type: "result", ok: false, label: "Turn failed (error_max_turns)" },
    ]);
  });

  it("leaves out messages it does not know", () => {
    expect(toRows([msg("raw", { type: "system", subtype: "init" }), msg("raw", { weird: true }), msg("tool_result", "x")])).toEqual([]);
  });
});

describe("toolDiff", () => {
  it("diffs every edit of MultiEdit and adds Write as new lines", () => {
    expect(toolDiff("MultiEdit", { edits: [{ old_string: "a", new_string: "b" }, { old_string: "c", new_string: "d" }] })).toEqual([
      { op: "-", text: "a" }, { op: "+", text: "b" }, { op: " ", text: "…" }, { op: "-", text: "c" }, { op: "+", text: "d" },
    ]);
    expect(toolDiff("Write", { content: "x\ny\n" })).toEqual([{ op: "+", text: "x" }, { op: "+", text: "y" }]);
    expect(toolDiff("Bash", { command: "ls" })).toBeUndefined();
  });
});

describe("resultNote", () => {
  it("counts lines, shows short single lines and flags errors", () => {
    expect(resultNote({ text: "a\nb\nc\n", isError: false })).toBe("3 lines");
    expect(resultNote({ text: "200", isError: false })).toBe("200");
    expect(resultNote({ text: "", isError: false })).toBe("done");
    expect(resultNote({ text: "nope", isError: true })).toBe("error");
  });
});

describe("applyDelta", () => {
  it("adds text deltas and starts over on a new message", () => {
    let text = "";
    for (const e of [
      { type: "message_start" },
      { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "x" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } },
      { type: "unknown_thing" },
    ]) text = applyDelta(text, e);
    expect(text).toBe("Hello");
    expect(applyDelta(text, { type: "message_start" })).toBe("");
    expect(applyDelta(text, null)).toBe("Hello");
  });
});
