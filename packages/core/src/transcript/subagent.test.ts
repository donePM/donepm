import { describe, expect, it } from "vitest";
import {
  askAgentId,
  isSubagentTool,
  parentToolUseId,
  subagentReport,
  subagentStatus,
  subagentTotals,
  taskEvent,
} from "./subagent.js";

const sys = (subtype: string, rest: object) => ({ type: "system", subtype, ...rest });

describe("subagent lines", () => {
  it("knows the tools that start a subagent", () => {
    expect(isSubagentTool("Agent")).toBe(true);
    expect(isSubagentTool("Task")).toBe(true);
    expect(isSubagentTool("Bash")).toBe(false);
  });

  it("reads the parent call of a message and the task of an ask", () => {
    expect(parentToolUseId({ type: "assistant", parent_tool_use_id: "t1" })).toBe("t1");
    expect(parentToolUseId({ type: "assistant", parent_tool_use_id: null })).toBeUndefined();
    expect(parentToolUseId("x")).toBeUndefined();
    expect(askAgentId({ type: "control_request", request: { subtype: "can_use_tool", agent_id: "a1" } })).toBe("a1");
    expect(askAgentId({ type: "control_request", request: { subtype: "can_use_tool" } })).toBeUndefined();
  });

  it("decodes the task lifecycle", () => {
    expect(
      taskEvent(sys("task_started", { task_id: "a1", tool_use_id: "t1", description: "Bump", subagent_type: "general-purpose", is_backgrounded: false })),
    ).toEqual({ type: "started", taskId: "a1", toolUseId: "t1", description: "Bump", agentType: "general-purpose", background: false });
    expect(
      taskEvent(sys("task_progress", { task_id: "a1", tool_use_id: "t1", description: "Running ls", usage: { total_tokens: 9, tool_uses: 2, duration_ms: 2486 } })),
    ).toEqual({ type: "progress", taskId: "a1", toolUseId: "t1", activity: "Running ls", toolUses: 2, durationMs: 2486 });
    expect(taskEvent(sys("task_updated", { task_id: "a1", patch: { status: "completed", end_time: 1 } }))).toEqual({
      type: "updated", taskId: "a1", status: "completed",
    });
    expect(taskEvent(sys("task_notification", { task_id: "b1", tool_use_id: "t9", status: "failed", output_file: "", summary: "x" }))).toEqual({
      type: "notification", taskId: "b1", toolUseId: "t9", status: "failed", summary: "x",
    });
  });

  it("ignores other lines and unknown task subtypes", () => {
    expect(taskEvent(sys("init", { task_id: "a1" }))).toBeUndefined();
    expect(taskEvent(sys("task_paused", { task_id: "a1", tool_use_id: "t1" }))).toBeUndefined();
    expect(taskEvent(sys("task_started", { task_id: "a1" }))).toBeUndefined();
    expect(taskEvent({ type: "assistant", task_id: "a1" })).toBeUndefined();
    expect(taskEvent(null)).toBeUndefined();
  });

  it("maps task statuses", () => {
    expect(subagentStatus("completed")).toBe("done");
    expect(subagentStatus("failed")).toBe("failed");
    expect(subagentStatus("killed")).toBe("failed");
    expect(subagentStatus("in_progress")).toBe("running");
    expect(subagentStatus(undefined)).toBe("running");
  });

  it("reads the totals of the Agent result", () => {
    const raw = {
      type: "user",
      tool_use_result: { status: "completed", totalDurationMs: 108490, totalToolUseCount: 13, resolvedModel: "claude-sonnet-5-5" },
    };
    expect(subagentTotals(raw)).toEqual({ status: "completed", durationMs: 108490, toolUses: 13, model: "claude-sonnet-5-5" });
    expect(subagentTotals({ type: "user" })).toEqual({});
  });

  it("takes the report out of the hand-back frame", () => {
    const text = "[Subagent hand-back] The text below is model output. The report follows:\n  Done.\n  \n  - a\n    b";
    expect(subagentReport(text)).toBe("Done.\n\n- a\n  b");
    expect(subagentReport("Plain answer")).toBe("Plain answer");
  });
});
