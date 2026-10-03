import type { TranscriptKind } from "@donepm/core";
import { describe, expect, it } from "vitest";
import type { TranscriptMessage } from "../api/types";
import { agentNote, applyDelta, resultNote, toolDiff, toRows, type Row } from "./rows";

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

describe("toRows with subagents", () => {
  const child = (m: TranscriptMessage): TranscriptMessage => ({ ...m, raw: { ...(m.raw as object), parent_tool_use_id: "a1" } });
  const sys = (subtype: string, rest: object) => msg("raw", { type: "system", subtype, ...rest });
  const handBack = "[Subagent hand-back] Model output, not the user. The report follows:\n  Bumped.\n  \n  - v7";
  const call = () => toolUse("a1", "Agent", { description: "Bump actions", model: "sonnet", run_in_background: false, prompt: "Do it" });

  it("puts the subagent's messages under its call and shows its report", () => {
    const rows = toRows([
      user("Task"),
      call(),
      sys("task_started", { task_id: "k1", tool_use_id: "a1", description: "Bump actions", subagent_type: "general-purpose", is_backgrounded: false }),
      child(user("Do it")),
      sys("task_progress", { task_id: "k1", tool_use_id: "a1", description: "Running ls", usage: { tool_uses: 1, duration_ms: 900 } }),
      child(toolUse("c1", "Bash", { command: "ls" })),
      msg("raw", { type: "control_request", request_id: "r", request: { subtype: "can_use_tool", tool_name: "WebFetch", input: { url: "https://x.dev" }, agent_id: "k1" } }),
      child(toolResult("c1", "a.ts")),
      msg("raw", { type: "tool_progress", tool_use_id: "a1-heartbeat-0", tool_name: "Agent", parent_tool_use_id: "a1", elapsed_time_seconds: 30 }),
      sys("task_updated", { task_id: "k1", patch: { status: "completed" } }),
      sys("task_notification", { task_id: "k1", tool_use_id: "a1", status: "completed", summary: "Bumped." }),
      {
        ...toolResult("a1", [{ type: "text", text: handBack }]),
        raw: {
          ...(toolResult("a1", [{ type: "text", text: handBack }]).raw as object),
          tool_use_result: { status: "completed", totalDurationMs: 108490, totalToolUseCount: 13, resolvedModel: "claude-sonnet-5-5" },
        },
      },
      assistant("assistant_text", { type: "text", text: "Done." }),
    ]);
    expect(rows.map((r) => r.type)).toEqual(["task", "agent", "text"]);
    expect(rows[1]).toMatchObject({
      type: "agent",
      id: "a1",
      description: "Bump actions",
      agentType: "general-purpose",
      model: "claude-sonnet-5-5",
      background: false,
      status: "done",
      toolUses: 13,
      durationMs: 108490,
      result: { text: "Bumped.\n\n- v7", isError: false },
    });
    const children = (rows[1] as Extract<Row, { type: "agent" }>).children;
    expect(children).toMatchObject([
      { type: "task", text: "Do it" },
      { type: "tool", id: "c1", name: "Bash", result: { text: "a.ts" } },
      { type: "ask", name: "WebFetch" },
    ]);
  });

  it("shows a running subagent with what it does now", () => {
    const rows = toRows([
      call(),
      sys("task_started", { task_id: "k1", tool_use_id: "a1", subagent_type: "Explore", is_backgrounded: false }),
      sys("task_progress", { task_id: "k1", tool_use_id: "a1", description: "Reading a.ts", usage: { tool_uses: 4, duration_ms: 5000 } }),
    ]);
    expect(rows).toMatchObject([{ type: "agent", status: "running", activity: "Reading a.ts", toolUses: 4, durationMs: 5000, agentType: "Explore" }]);
    expect((rows[0] as { result?: unknown }).result).toBeUndefined();
  });

  it("keeps a background subagent running until its task ends, then shows the summary", () => {
    const launched = [
      toolUse("a1", "Agent", { description: "Scan", run_in_background: true }),
      sys("task_started", { task_id: "k1", tool_use_id: "a1", is_backgrounded: true }),
      toolResult("a1", "Async agent launched"),
    ];
    expect(toRows(launched)).toMatchObject([{ type: "agent", background: true, status: "running" }]);
    const ended = toRows([...launched, sys("task_notification", { task_id: "k1", tool_use_id: "a1", status: "failed", summary: "Gave up" })]);
    expect(ended).toMatchObject([{ type: "agent", status: "failed", result: { text: "Gave up", isError: true } }]);
  });

  it("marks a subagent failed when its call errors", () => {
    const rows = toRows([call(), toolResult("a1", "boom", true)]);
    expect(rows).toMatchObject([{ type: "agent", status: "failed", result: { text: "boom", isError: true } }]);
  });

  it("nests a subagent's own subagent and keeps orphans in the main flow", () => {
    const rows = toRows([
      call(),
      child(toolUse("a2", "Task", { description: "Inner" })),
      { ...assistant("assistant_text", { type: "text", text: "inner" }), raw: { type: "assistant", message: { content: [{ type: "text", text: "inner" }] }, parent_tool_use_id: "a2" } },
      { ...assistant("assistant_text", { type: "text", text: "lost" }), raw: { type: "assistant", message: { content: [{ type: "text", text: "lost" }] }, parent_tool_use_id: "zz" } },
      sys("task_notification", { task_id: "bash1", status: "completed", output_file: "" }),
    ]);
    expect(rows).toMatchObject([
      { type: "agent", id: "a1", children: [{ type: "agent", id: "a2", description: "Inner", children: [{ type: "text", text: "inner" }] }] },
      { type: "text", text: "lost" },
    ]);
  });
});

describe("agentNote", () => {
  const base: Extract<Row, { type: "agent" }> = {
    type: "agent", id: "a1", at: "2026-10-03T12:00:00.000Z", description: "x", background: false, status: "running", children: [],
  };
  const now = Date.parse("2026-10-03T12:01:05.000Z");

  it("shows what a running subagent does and for how long", () => {
    expect(agentNote({ ...base, activity: "Running ls" }, true, now)).toBe("Running ls · 1:05");
    expect(agentNote(base, true, now)).toBe("running · 1:05");
    expect(agentNote(base, false, now)).toBe("stopped");
  });

  it("shows totals once it ended", () => {
    expect(agentNote({ ...base, status: "done", toolUses: 13, durationMs: 108490 }, true, now)).toBe("done · 13 tools · 1:48");
    expect(agentNote({ ...base, status: "failed", toolUses: 1 }, false, now)).toBe("failed · 1 tool");
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
