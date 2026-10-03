import { start, type Playbook, type WorkItem } from "@donepm/core";
import { describe, expect, it } from "vitest";
import { AskStore } from "../asks/store.js";
import { openDb } from "../db/database.js";
import { EventStore } from "../events/store.js";
import { itemWriter } from "../items/commit.js";
import { ItemStore } from "../items/store.js";
import { silentLog } from "../log.js";
import { testCtx } from "../test-support/ctx.js";
import { fixture } from "../test-support/fake-exec.js";
import { fakeProcesses } from "../test-support/fake-process.js";
import { TranscriptStore } from "../transcript/store.js";
import { AgentBusyError, AgentRunner, AskError } from "./runner.js";

const playbook: Playbook = { name: "implement", model: "haiku", permissionMode: "acceptEdits", drafts: ["pr"], body: "" };
const lines = (name: string) => fixture(`stream/${name}`).split("\n").filter(Boolean);

function setup(maxConcurrent = 1) {
  const db = openDb(":memory:");
  const ctx = testCtx();
  const items = new ItemStore(db);
  const events = new EventStore(db);
  const asks = new AskStore(db);
  const transcript = new TranscriptStore(db);
  const pushed: Array<{ type: string; payload: any }> = [];
  const spawn = fakeProcesses();
  const writer = itemWriter({ db, items, events, onItem: () => {}, onEvent: () => {} });
  const runner = new AgentRunner({
    items, writer, asks, transcript, ctx, log: silentLog, spawn,
    push: (type, payload) => pushed.push({ type, payload }),
    claudePath: () => "/usr/local/bin/claude",
    env: async () => ({ PATH: "/filtered" }),
    maxConcurrent: () => maxConcurrent,
  });

  const addItem = (n: number): WorkItem => {
    const item: WorkItem = {
      id: `item-${n}`, source: "github-issue", externalId: `o/r#${n}`, externalUrl: `https://github.com/o/r/issues/${n}`,
      title: "T", body: "", labels: [], state: "ready", playbook: "implement", priority: n,
      createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
    };
    items.insert(item, "github.com/o/r");
    return writer.commit(start(item, ctx));
  };

  const launch = async (item: WorkItem, resumeSessionId?: string) => {
    runner.reserve(item.id);
    await runner.launch({ item, playbook, cwd: "/wt", prompt: "Do the thing", ...(resumeSessionId ? { resumeSessionId } : {}) });
    return spawn.last();
  };

  const state = (id: string) => items.get(id)!.item;
  const types = (id: string) => events.forItem(id).map((e) => e.type);
  return { db, items, events, asks, transcript, pushed, spawn, runner, addItem, launch, state, types };
}

describe("AgentRunner", () => {
  it("spawns claude in the worktree with the filtered env and sends the first message", async () => {
    const t = setup();
    const proc = await t.launch(t.addItem(1));
    expect(proc.cmd).toBe("/usr/local/bin/claude");
    expect(proc.opts).toEqual({ cwd: "/wt", env: { PATH: "/filtered" } });
    expect(proc.args).toContain("--permission-prompt-tool");
    expect(proc.sent()).toEqual([
      { type: "user", message: { role: "user", content: [{ type: "text", text: "Do the thing" }] } },
    ]);
    expect(t.transcript.page("item-1").map((m) => m.kind)).toEqual(["user"]);
  });

  it("stores a recorded session, binds the session id and ends the turn in Needs You", async () => {
    const t = setup();
    const proc = await t.launch(t.addItem(1));
    const recorded = lines("basic.jsonl");
    const sessionId = JSON.parse(recorded.find((l) => l.includes('"subtype":"init"'))!).session_id;
    proc.emit(...recorded);

    expect(t.state("item-1")).toMatchObject({ state: "needs_you", agentSessionId: sessionId });
    expect(t.types("item-1")).toEqual(["agent.started", "agent.turn_ended"]);
    expect(t.events.forItem("item-1")[1]!.payload).toMatchObject({ subtype: "success", isError: false, costUsd: expect.any(Number) });

    const stored = t.transcript.page("item-1");
    // Everything except stream events is stored, plus the first user message.
    expect(stored).toHaveLength(1 + recorded.length - 51);
    expect(stored.filter((m) => m.kind !== "raw").map((m) => m.kind)).toEqual([
      "user", "assistant_thinking", "tool_use", "tool_result", "tool_use", "tool_result",
      "assistant_thinking", "assistant_text", "result",
    ]);
    expect(stored.at(-1)!.sessionId).toBe(sessionId);
    expect(t.pushed.filter((p) => p.type === "stream.delta")).toHaveLength(51);
    expect(t.pushed.filter((p) => p.type === "transcript.appended")).toHaveLength(stored.length);
  });

  it("does not fail on unknown or malformed lines", async () => {
    const t = setup();
    const proc = await t.launch(t.addItem(1));
    proc.emit({ type: "system", subtype: "init", session_id: "s1" }, { type: "from_the_future", x: 1 }, '{"type":"assis');
    expect(t.state("item-1").state).toBe("running");
    expect(t.transcript.page("item-1").map((m) => m.kind)).toEqual(["user", "raw", "raw"]);
  });

  it("turns a permission question into an ask and answers it with the matching request id", async () => {
    const t = setup();
    const proc = await t.launch(t.addItem(1));
    const recorded = lines("ask-allow.jsonl");
    const at = recorded.findIndex((l) => l.includes('"control_request"'));
    proc.emit(...recorded.slice(0, at + 1));

    const [ask] = t.asks.forItem("item-1");
    expect(ask).toMatchObject({ toolName: "Bash", state: "pending" });
    expect(t.state("item-1").state).toBe("needs_you");

    t.runner.answer(ask!.id, { behavior: "allow" });
    const answer = proc.sent().at(-1);
    expect(answer).toEqual({
      type: "control_response",
      response: { request_id: ask!.requestId, subtype: "success", response: { behavior: "allow", updatedInput: ask!.input } },
    });
    expect(t.asks.get(ask!.id)!.state).toBe("allowed");
    expect(t.state("item-1").state).toBe("running");

    proc.emit(...recorded.slice(at + 1));
    expect(t.types("item-1")).toEqual(["agent.started", "permission.asked", "permission.answered", "agent.turn_ended"]);
  });

  it("denies with a message and refuses a second answer", async () => {
    const t = setup();
    const proc = await t.launch(t.addItem(1));
    proc.emit({ type: "control_request", request_id: "r1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "curl x" } } });
    const [ask] = t.asks.forItem("item-1");
    t.runner.answer(ask!.id, { behavior: "deny", message: "No network." });
    expect(proc.sent().at(-1).response.response).toEqual({ behavior: "deny", message: "No network." });
    expect(() => t.runner.answer(ask!.id, { behavior: "allow" })).toThrow(AskError);
    expect(() => t.runner.answer("nope", { behavior: "allow" })).toThrow(/not found/);
  });

  it("keeps waiting until every parallel ask is answered", async () => {
    const t = setup();
    const proc = await t.launch(t.addItem(1));
    for (const id of ["r1", "r2"]) {
      proc.emit({ type: "control_request", request_id: id, request: { subtype: "can_use_tool", tool_name: "Bash", input: {} } });
    }
    const [a, b] = t.asks.forItem("item-1");
    t.runner.answer(a!.id, { behavior: "allow" });
    expect(t.state("item-1").state).toBe("needs_you");
    t.runner.answer(b!.id, { behavior: "allow" });
    expect(t.state("item-1").state).toBe("running");
  });

  it("treats a second init after a result as a turn the CLI started on its own", async () => {
    const t = setup();
    const proc = await t.launch(t.addItem(1));
    proc.emit(
      { type: "system", subtype: "init", session_id: "s1" },
      { type: "result", subtype: "success", is_error: false, session_id: "s1" },
    );
    expect(t.state("item-1").state).toBe("needs_you");
    proc.emit({ type: "system", subtype: "init", session_id: "s1" });
    expect(t.state("item-1").state).toBe("running");
    expect(t.types("item-1")).toEqual(["agent.started", "agent.turn_ended", "agent.turn_started"]);
  });

  it("fails the item with the stderr tail when claude exits without a result", async () => {
    const t = setup();
    const proc = await t.launch(t.addItem(1));
    proc.stderr(Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n") + "\n");
    proc.exit(1);
    expect(t.state("item-1").state).toBe("failed");
    const failed = t.events.forItem("item-1").at(-1)!;
    expect(failed.payload.reason).toMatch(/code 1/);
    expect(failed.payload.stderrTail).toHaveLength(50);
    expect((failed.payload.stderrTail as string[])[0]).toBe("line 10");
    expect(t.runner.count).toBe(0);
  });

  it("leaves the item alone when claude exits cleanly after its turn", async () => {
    const t = setup();
    const proc = await t.launch(t.addItem(1));
    proc.emit({ type: "system", subtype: "init", session_id: "s1" }, { type: "result", subtype: "success", session_id: "s1" });
    proc.exit(0);
    expect(t.state("item-1").state).toBe("needs_you");
  });

  it("allows one agent at a time by default", async () => {
    const t = setup();
    await t.launch(t.addItem(1));
    expect(() => t.runner.reserve("item-2")).toThrow(AgentBusyError);
  });

  it("frees a reserved slot that never launched", () => {
    const t = setup();
    const slot = t.runner.reserve("item-1");
    slot.release();
    expect(t.runner.count).toBe(0);
  });

  it("passes --resume with the stored session", async () => {
    const t = setup();
    const proc = await t.launch(t.addItem(1), "sess-9");
    expect(proc.args.slice(-2)).toEqual(["--resume", "sess-9"]);
  });

  it("on shutdown sends SIGTERM, then SIGKILL to a process that hangs, and keeps the item running", async () => {
    const t = setup(2);
    const polite = await t.launch(t.addItem(1));
    const stubborn = await t.launch(t.addItem(2));
    stubborn.exitOnSignal = false;
    await t.runner.stopAll(10);
    expect(polite.signals).toEqual(["SIGTERM"]);
    expect(stubborn.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(t.state("item-1").state).toBe("running");
    expect(t.state("item-2").state).toBe("running");
  });
});
