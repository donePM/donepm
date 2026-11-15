import { start, type AgentEvent, type Playbook, type WorkItem } from "@donepm/core";
import { describe, expect, it } from "vitest";
import { GrantStore } from "../asks/grants.js";
import { AskStore } from "../asks/store.js";
import { openDb } from "../db/database.js";
import { EventStore } from "../events/store.js";
import { itemWriter } from "../items/commit.js";
import { ItemStore } from "../items/store.js";
import { silentLog } from "../log.js";
import { testCtx } from "../test-support/ctx.js";
import { fakeProcesses } from "../test-support/fake-process.js";
import { TranscriptStore } from "../transcript/store.js";
import type { AgentAdapter, AgentStep, AgentWrite } from "./adapter.js";
import { AgentRunner } from "./runner.js";

/**
 * A made-up agent with its own small protocol, to show the runner needs nothing of Claude Code's
 * (issue #136). It reports no price, has no rule grammar and speaks in `{op}` lines.
 */
const fakeAgent: AgentAdapter = {
  kind: "claude-code",
  command: "fake-agent",
  capabilities: { permissionModes: ["default"], sessionRules: false, runAccept: false, alwaysAllow: false, reportsCost: false, resumeInSameProcess: false },
  launch: (input) => ({ args: ["run", ...(input.resumeSessionId ? ["--continue", input.resumeSessionId] : [])] }),
  connect: () => ({
    decode(line): AgentStep[] {
      let msg: Record<string, any>;
      try {
        msg = JSON.parse(line) as Record<string, any>;
      } catch {
        return [{ type: "malformed", line }];
      }
      const events: Record<string, () => AgentEvent[]> = {
        hello: () => [{ type: "session_bound", sessionId: msg.thread }, { type: "turn_started" }],
        say: () => [{ type: "message", kind: "assistant_text", raw: msg }],
        run: () => [{ type: "message", kind: "tool_use", raw: msg }, { type: "tool_started", id: msg.id, name: "shell", summary: msg.cmd }],
        ran: () => [{ type: "message", kind: "tool_result", raw: msg }, { type: "tool_finished", id: msg.id }],
        approve: () => [
          { type: "raw", raw: msg },
          { type: "ask", ask: { requestId: msg.id, toolName: "exec", input: { argv: msg.argv }, subject: { kind: "command", command: msg.argv.join(" ") } } },
        ],
        done: () => [
          { type: "message", kind: "result", raw: msg },
          { type: "usage", usage: { inputTokens: 10, outputTokens: 2, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 } },
          { type: "turn_ended", isError: false, interrupted: false },
        ],
      };
      return events[msg.op]?.() ?? [{ type: "raw", raw: msg }];
    },
    firstTurn: (text) => [send({ op: "task", text }, "user")],
    nextTurn: (text) => [send({ op: "more", text }, "user")],
    answerAsk: (ask, reply) => [send({ op: "decision", id: ask.requestId, ok: reply.behavior === "allow" }, "raw")],
  }),
};

function send(msg: object, kind: "user" | "raw"): AgentWrite {
  return { type: "write", line: JSON.stringify(msg), record: { kind, raw: msg } };
}

const playbook: Playbook = { name: "implement", model: "m", permissionMode: "default", drafts: ["pr"], body: "" };

function setup() {
  const db = openDb(":memory:");
  const ctx = testCtx();
  const items = new ItemStore(db);
  const events = new EventStore(db);
  const asks = new AskStore(db);
  const transcript = new TranscriptStore(db);
  const spawn = fakeProcesses();
  const writer = itemWriter({ db, items, events, onItem: () => {}, onEvent: () => {} });
  const runner = new AgentRunner({
    items, writer, asks, grants: new GrantStore(db), transcript, ctx, log: silentLog, spawn, push: () => {},
    agentPath: () => undefined,
    adapterFor: () => fakeAgent,
    env: async () => ({ PATH: "/filtered" }),
    maxConcurrent: () => 1,
  });
  const item: WorkItem = {
    id: "item-1", source: "github-issue", externalId: "o/r#1", externalUrl: "https://github.com/o/r/issues/1",
    title: "T", body: "", labels: [], state: "ready", playbook: "implement", priority: 1,
    stateSince: "2026-10-01T00:00:00.000Z", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
  };
  items.insert(item, "github.com/o/r");
  writer.commit(start(item, ctx));
  const launch = async (resumeSessionId?: string) => {
    runner.reserve("item-1");
    await runner.launch({ item: items.get("item-1")!.item, playbook, cwd: "/wt", prompt: "Do it", ...(resumeSessionId ? { resumeSessionId } : {}) });
    return spawn.last();
  };
  const state = () => items.get("item-1")!.item;
  const types = () => events.forItem("item-1").map((e) => e.type);
  return { runner, asks, events, transcript, launch, state, types };
}

describe("AgentRunner with another agent's adapter", () => {
  it("runs a turn, asks, answers and ends it without Claude Code's protocol", async () => {
    const t = setup();
    const proc = await t.launch();
    expect(proc.cmd).toBe("fake-agent");
    expect(proc.args).toEqual(["run"]);
    expect(proc.sent()).toEqual([{ op: "task", text: "Do it" }]);

    proc.emit({ op: "hello", thread: "th-1" }, { op: "run", id: "c1", cmd: "ls" });
    expect(t.state().agentSessionId).toBe("th-1");
    expect(t.runner.currentTool("item-1")).toEqual({ name: "shell", summary: "ls" });

    proc.emit({ op: "ran", id: "c1" }, { op: "approve", id: "q1", argv: ["rm", "-rf", "build"] });
    expect(t.runner.currentTool("item-1")).toBeUndefined();
    expect(t.state().state).toBe("needs_you");
    const [ask] = t.asks.pending("item-1");
    expect(ask).toMatchObject({ agentKind: "claude-code", requestId: "q1", toolName: "exec", subject: { kind: "command", command: "rm -rf build" }, rules: [] });

    // No rule grammar: "Always allow" is not offered, a plain allow is.
    expect(() => t.runner.answer(ask!.id, { behavior: "allow", scope: "always" })).toThrow("always allow is not available");
    t.runner.answer(ask!.id, { behavior: "allow", scope: "run" });
    expect(proc.sent().at(-1)).toEqual({ op: "decision", id: "q1", ok: true });
    expect(t.state().state).toBe("running");

    proc.emit({ op: "say", text: "Done" }, { op: "done" });
    expect(t.state().state).toBe("needs_you");
    const ended = t.events.forItem("item-1").at(-1)!;
    expect(ended.type).toBe("agent.turn_ended");
    // No price reported: no cost in the event, never a made-up zero.
    expect(ended.payload).toEqual({ subtype: null, isError: false, usage: { inputTokens: 10, outputTokens: 2, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 } });
    expect(t.transcript.page("item-1").map((m) => m.kind)).toEqual(["user", "tool_use", "tool_result", "raw", "raw", "assistant_text", "result"]);

    proc.exit(0);
    expect(t.state().state).toBe("needs_you");
  });

  it("keeps unknown lines and names the agent when it dies mid-turn", async () => {
    const t = setup();
    const proc = await t.launch();
    proc.emit({ op: "hello", thread: "th-1" }, { op: "news", x: 1 }, "{not json");
    expect(t.transcript.page("item-1").map((m) => m.kind)).toEqual(["user", "raw"]);
    proc.exit(3);
    expect(t.state().state).toBe("failed");
    expect(t.events.forItem("item-1").at(-1)!.payload).toMatchObject({ reason: "fake-agent exited with code 3 before finishing its turn" });
  });

  it("denies a pending ask in the agent's words on Stop, and resumes with the stored session", async () => {
    const t = setup();
    const proc = await t.launch();
    proc.emit({ op: "hello", thread: "th-1" }, { op: "approve", id: "q1", argv: ["make"] });
    await t.runner.stop("item-1");
    expect(proc.sent().at(-1)).toEqual({ op: "decision", id: "q1", ok: false });
    expect(t.asks.pending("item-1")).toEqual([]);

    const again = await t.launch("th-1");
    expect(again.args).toEqual(["run", "--continue", "th-1"]);
  });
});
