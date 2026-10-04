import type { TranscriptKind } from "@donepm/core";
import { describe, expect, it } from "vitest";
import type { TranscriptMessage } from "../api/types";
import type { PermissionAsk } from "../api/types";
import subagentRun from "../../../daemon/fixtures/stream/subagent.jsonl?raw";
import {
  agentNote, applyDelta, askOutcomeText, commandPreview, diffPreview, groupReads, hasPendingAsk, lastTool, outputTail, resultNote, stepTime,
  toolDiff, toRows, type DiffLine, type Row, type ToolRow,
} from "./rows";

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
      msg("system", { type: "donepm_setup", step: "dependencies", manager: "pnpm", method: "clone", dirs: ["node_modules", "packages/web/node_modules"], ok: true }),
      msg("system", {
        type: "donepm_setup", step: "dependencies", manager: "composer", method: "install", command: "composer install --no-interaction",
        reason: "the main clone has no vendor", ok: true, code: 0, stdout: "Installing", stderr: "",
      }),
    ]);
    expect(rows).toEqual([
      { type: "setup", id: expect.any(String), label: "copy .env", ok: true, output: "" },
      { type: "setup", id: expect.any(String), label: "run composer install", ok: false, output: "no php" },
      { type: "setup", id: expect.any(String), label: "copy node_modules, packages/web/node_modules from the main clone (pnpm)", ok: true, output: "" },
      { type: "setup", id: expect.any(String), label: "run composer install --no-interaction", ok: true, output: "(the main clone has no vendor)\nInstalling" },
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

  describe("ask state", () => {
    const asked = (id: string, toolName = "Bash", extra: object = {}) =>
      msg("raw", { type: "control_request", request_id: id, request: { subtype: "can_use_tool", tool_name: toolName, input: { command: "ls\npwd" }, ...extra } });
    const answer = (id: string, response: object) =>
      msg("raw", { type: "control_response", response: { request_id: id, subtype: "success", response } });
    const stored = (requestId: string, state: PermissionAsk["state"]): PermissionAsk => ({
      id: `ask-${requestId}`, itemId: "i1", agentKind: "claude-code", requestId, toolName: "Bash", input: {}, subject: { kind: "tool", name: "Bash", input: {} }, state, rules: [],
    });
    type AskRow = Extract<Row, { type: "ask" }>;

    it("carries the full input and the CLI's reason", () => {
      const [row] = toRows([asked("r1", "Bash", { decision_reason: "This command requires approval" })]);
      expect(row).toMatchObject({ type: "ask", summary: "ls; pwd", input: { command: "ls\npwd" }, reason: "This command requires approval" });
    });

    it("hands out the stored ask only while it waits", () => {
      const asks = [stored("r1", "pending"), stored("r2", "expired")];
      const [pending, expired] = toRows([asked("r1"), asked("r2")], asks) as AskRow[];
      expect(pending).toMatchObject({ ask: { id: "ask-r1" }, outcome: "pending" });
      expect(expired!.ask).toBeUndefined();
      expect(expired!.outcome).toBe("expired");
    });

    it("reads how it was answered from the transcript", () => {
      const rows = toRows(
        [
          asked("r1"), answer("r1", { behavior: "allow", updatedInput: {} }),
          asked("r2"), answer("r2", { behavior: "allow", updatedInput: {}, updatedPermissions: [{ type: "addRules" }] }),
          asked("r3"), answer("r3", { behavior: "deny", message: "no" }),
        ],
        // The store may not have caught up yet; the answer in the transcript wins.
        [stored("r1", "pending")],
      ) as AskRow[];
      expect(rows.map((r) => [r.outcome, askOutcomeText(r), r.ask])).toEqual([
        ["allowed", "allowed", undefined],
        ["allowed_run", "allowed for this run", undefined],
        ["denied", "denied", undefined],
      ]);
    });

    it("words questions as answered or declined, and leaves unknown outcomes blank", () => {
      const rows = toRows([asked("q1", "AskUserQuestion"), answer("q1", { behavior: "deny" }), asked("q2")]) as AskRow[];
      expect(rows.map(askOutcomeText)).toEqual(["declined", ""]);
    });

    it("adds the reason an ask ended without the user's answer", () => {
      const stored: PermissionAsk = { id: "a1", itemId: "i1", agentKind: "claude-code", requestId: "q1", toolName: "Bash", input: {}, subject: { kind: "tool", name: "Bash", input: {} }, state: "expired", rules: [], outcomeReason: "donePM was not running when this was asked" };
      const rows = toRows([asked("q1")], [stored]) as AskRow[];
      expect(askOutcomeText(rows[0]!)).toBe("expired: donePM was not running when this was asked");
    });

    it("finds a pending ask inside a subagent", () => {
      const rows = toRows(
        [
          toolUse("a1", "Agent", { description: "Look" }),
          msg("raw", { type: "system", subtype: "task_started", task_id: "k1", tool_use_id: "a1" }),
          msg("raw", {
            type: "control_request", request_id: "r1", agent_id: "k1",
            request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls" }, agent_id: "k1" },
          }),
        ],
        [stored("r1", "pending")],
      );
      expect(rows).toHaveLength(1);
      expect(hasPendingAsk(rows[0]!)).toBe(true);
      expect(hasPendingAsk(toRows([toolUse("a2", "Agent", { description: "Look" })])[0]!)).toBe(false);
    });
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
  const note = (name: string, text: string, isError = false, extra: Partial<ToolRow> = {}) =>
    resultNote({ name, result: { text, isError }, ...extra });

  it("counts lines, shows short single lines and flags errors", () => {
    expect(note("Bash", "a\nb\nc\n")).toBe("3 lines");
    expect(note("Bash", "200")).toBe("200");
    expect(note("Bash", "")).toBe("done");
    expect(note("Bash", "nope", true)).toBe("error");
    expect(note("Bash", "Exit code 2\nboom", true)).toBe("exit 2");
    expect(resultNote({ name: "Bash" })).toBe("");
  });

  it("shows lines added and removed for edits, nothing for todos", () => {
    expect(note("Edit", "The file a.ts has been updated.", false, { diffStat: { added: 3, removed: 1 } })).toBe("+3 −1");
    expect(note("Edit", "File has not been read yet", true, { diffStat: { added: 3, removed: 1 } })).toBe("error");
    expect(note("TodoWrite", "Todos have been modified successfully.")).toBe("");
  });
});

describe("step details", () => {
  it("previews a diff from just before its first change", () => {
    const lines: DiffLine[] = ["a", "b", "c"].map((text) => ({ op: " ", text }));
    const diff: DiffLine[] = [...lines, { op: "-", text: "d" }, { op: "+", text: "e" }, ...lines];
    expect(diffPreview(diff, 3)).toEqual([{ op: " ", text: "c" }, { op: "-", text: "d" }, { op: "+", text: "e" }]);
    expect(diffPreview([{ op: "+", text: "x" }])).toEqual([{ op: "+", text: "x" }]);
  });

  it("cuts commands and keeps the end of failed output", () => {
    expect(commandPreview("a\nb\nc\nd", 3)).toEqual({ text: "a\nb\nc", more: true });
    expect(commandPreview("a", 3)).toEqual({ text: "a", more: false });
    expect(outputTail("1\n2\n3\n4\n", 2)).toBe("3\n4");
  });

  it("says when a step ran and for how long", () => {
    const row = toRows([toolUse("t1", "Bash", { command: "x" }), { ...toolResult("t1", "ok"), at: "2026-10-03T12:00:42.000Z" }])[0] as ToolRow;
    expect(stepTime(row)).toMatch(/ · took 0:42$/);
    expect(stepTime({ ...row, result: undefined })).not.toContain("took");
  });

  it("shows the command under a described Bash call and lists todos", () => {
    const todos = [{ content: "Read", activeForm: "Reading", status: "completed" }, { content: "Fix", activeForm: "Fixing", status: "in_progress" }];
    const rows = toRows([
      toolUse("t1", "Bash", { command: "cd /w && pnpm test", description: "Run tests" }),
      toolUse("t2", "Bash", { command: "ls" }),
      toolUse("t3", "TodoWrite", { todos }),
      toolUse("t4", "Edit", { file_path: "/w/a.ts", old_string: "a\n", new_string: "b\nc\n" }),
    ], [], { cwd: "/w" });
    expect(rows).toMatchObject([
      { summary: "Run tests", command: "cd /w && pnpm test" },
      { summary: "ls" },
      { summary: "Fixing", todos: [{ content: "Read", status: "completed" }, { content: "Fix", status: "in_progress" }] },
      { summary: "a.ts", diffStat: { added: 2, removed: 1 } },
    ]);
    expect((rows[1] as ToolRow).command).toBeUndefined();
  });
});

describe("groupReads", () => {
  it("collapses consecutive Read, Grep and Glob calls into one line", () => {
    const rows = toRows([
      toolUse("t1", "Read", { file_path: "/w/src/a.ts" }),
      toolUse("t2", "Read", { file_path: "/w/src/b.ts" }),
      toolUse("t3", "Read", { file_path: "/w/src/a.ts", offset: 100, limit: 20 }),
      toolUse("t4", "Grep", { pattern: "TODO" }),
      assistant("assistant_text", { type: "text", text: "Found it." }),
      toolUse("t5", "Read", { file_path: "/w/c.ts" }),
      toolUse("t6", "Bash", { command: "ls" }),
      toolUse("t7", "Glob", { pattern: "*.ts" }),
      toolUse("t8", "Glob", { pattern: "*.vue" }),
      toolResult("t8", "No files found", true),
    ], [], { cwd: "/w" });
    expect(rows.map((r) => r.type)).toEqual(["group", "text", "tool", "tool", "group"]);
    expect(rows[0]).toMatchObject({ id: "group:t1", label: "Read 2 files, 1 search", summary: "a.ts, b.ts, a.ts:100-119, TODO" });
    expect((rows[0] as Extract<Row, { type: "group" }>).children.map((c) => c.id)).toEqual(["t1", "t2", "t3", "t4"]);
    expect(rows[4]).toMatchObject({ label: "2 searches", summary: "*.ts, *.vue" });
    expect(lastTool(rows)?.id).toBe("t8");
    expect(lastTool(rows.slice(0, 2))?.id).toBe("t4");
    expect(lastTool([])).toBeUndefined();
  });

  it("groups inside subagents too and leaves single calls alone", () => {
    const tool = (id: string, name: string): ToolRow => ({ type: "tool", id, at: "", name, summary: id, input: {} });
    const agent: Row = {
      type: "agent", id: "a", at: "", description: "", background: false, status: "running", children: [tool("r1", "Read"), tool("r2", "Grep")],
    };
    const rows = groupReads([tool("r0", "Read"), agent]);
    expect(rows.map((r) => r.type)).toEqual(["tool", "agent"]);
    expect((rows[1] as Extract<Row, { type: "agent" }>).children).toMatchObject([{ type: "group", label: "Read 1 file, 1 search" }]);
  });
});

/** The daemon's message kinds for a recorded stream-json line (see `decode.ts`). */
function recorded(jsonl: string): TranscriptMessage[] {
  return jsonl.split("\n").filter(Boolean).flatMap((line, i): TranscriptMessage[] => {
    const raw = JSON.parse(line);
    const block = Array.isArray(raw.message?.content) ? raw.message.content[0] : undefined;
    const kind: TranscriptKind =
      raw.type === "result" ? "result"
      : raw.type === "assistant" ? (block?.type === "thinking" ? "assistant_thinking" : block?.type === "tool_use" ? "tool_use" : "assistant_text")
      : raw.type === "user" ? (block?.type === "tool_result" ? "tool_result" : "user")
      : "raw";
    return [{ id: `r${i}`, itemId: "i1", sessionId: "s1", at: "2026-10-03T12:00:00.000Z", kind, raw }];
  });
}

describe("a recorded run", () => {
  it("reads top to bottom without opening rows", () => {
    const rows = toRows(recorded(subagentRun), [], { cwd: "/tmp/donepm-fixture" });
    const agent = rows.find((r) => r.type === "agent") as Extract<Row, { type: "agent" }>;
    const steps = agent.children.filter((r): r is ToolRow => r.type === "tool");
    const line = (r: ToolRow) => `${r.name} ${r.summary} · ${resultNote(r)}`;
    // Every step says what it did and how it ended in one line.
    for (const s of steps) {
      expect(s.summary).not.toBe("");
      expect(s.summary).not.toContain("\n");
    }
    expect(line(steps[0]!)).toMatch(/^Bash cat \.github\/workflows\/\*\.yml; ls \.github\/workflows; grep .* · exit 1$/);
    expect(steps.map((s) => s.summary)).toContain("github.com/actions/checkout/releases");
    const commit = steps.find((s) => s.summary.startsWith("git status --short; git add"))!;
    expect(commit.command).toContain("ci: move GitHub Actions to Node 24 majors");
    const verify = rows.find((r): r is ToolRow => r.type === "tool" && r.name === "Bash")!;
    expect(verify).toMatchObject({ summary: "Verify commit and action versions", command: expect.stringMatching(/^git log --oneline -2/) });
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
