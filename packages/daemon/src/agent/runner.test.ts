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
import { AgentBusyError, AgentRunner, AskError, StopError } from "./runner.js";

const playbook: Playbook = { name: "implement", model: "haiku", permissionMode: "acceptEdits", drafts: ["pr"], body: "" };
const lines = (name: string) => fixture(`stream/${name}`).split("\n").filter(Boolean);

function setup(maxConcurrent = 1, webFetchDomains: string[] = []) {
  const db = openDb(":memory:");
  const ctx = testCtx();
  const items = new ItemStore(db);
  const events = new EventStore(db);
  const asks = new AskStore(db);
  const transcript = new TranscriptStore(db);
  const pushed: Array<{ type: string; payload: any }> = [];
  const activity: string[] = [];
  const spawn = fakeProcesses();
  const writer = itemWriter({ db, items, events, onItem: () => {}, onEvent: () => {} });
  const runner = new AgentRunner({
    items, writer, asks, transcript, ctx, log: silentLog, spawn,
    push: (type, payload) => pushed.push({ type, payload }),
    claudePath: () => "/usr/local/bin/claude",
    env: async () => ({ PATH: "/filtered" }),
    maxConcurrent: () => maxConcurrent,
    onActivity: (id) => activity.push(id),
    webFetchDomains: () => webFetchDomains,
  });

  const addItem = (n: number): WorkItem => {
    const item: WorkItem = {
      id: `item-${n}`, source: "github-issue", externalId: `o/r#${n}`, externalUrl: `https://github.com/o/r/issues/${n}`,
      title: "T", body: "", labels: [], state: "ready", playbook: "implement", priority: n,
      stateSince: "2026-10-01T00:00:00.000Z", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
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
  return { db, items, events, asks, transcript, pushed, activity, spawn, runner, addItem, launch, state, types };
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

  it("grants the suggested rules for the run and records them", async () => {
    const t = setup();
    const proc = await t.launch(t.addItem(1));
    const recorded = lines("ask-allow.jsonl");
    proc.emit(...recorded.slice(0, recorded.findIndex((l) => l.includes('"control_request"')) + 1));
    const [ask] = t.asks.forItem("item-1");
    expect(ask!.rules).toEqual([{ toolName: "Bash", ruleContent: "curl *" }]);

    t.runner.answer(ask!.id, { behavior: "allow", scope: "run" });
    expect(proc.sent().at(-1).response.response.updatedPermissions).toEqual([
      { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "curl *" }], behavior: "allow", destination: "session" },
    ]);
    expect(t.events.forItem("item-1").find((e) => e.type === "permission.answered")!.payload).toEqual({
      behavior: "allow", rules: [{ toolName: "Bash", ruleContent: "curl *" }], interrupt: false,
    });
  });

  it("stores why the CLI asked", async () => {
    const t = setup();
    const proc = await t.launch(t.addItem(1));
    proc.emit({
      type: "control_request", request_id: "r1",
      request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls" }, decision_reason: "This command requires approval" },
    });
    expect(t.asks.forItem("item-1")[0]!.reason).toBe("This command requires approval");
  });

  it("never stores a suggested rule the deny list forbids", async () => {
    const t = setup();
    const proc = await t.launch(t.addItem(1));
    proc.emit({
      type: "control_request", request_id: "r1",
      request: {
        subtype: "can_use_tool", tool_name: "Bash", input: { command: "git push" },
        permission_suggestions: [{ type: "addRules", behavior: "allow", rules: [{ toolName: "Bash", ruleContent: "git push:*" }] }],
      },
    });
    const [ask] = t.asks.forItem("item-1");
    expect(ask!.rules).toEqual([]);
    t.runner.answer(ask!.id, { behavior: "allow", scope: "run" });
    expect(proc.sent().at(-1).response.response).not.toHaveProperty("updatedPermissions");
  });

  it("answers AskUserQuestion with the user's answers written into the input", async () => {
    const t = setup();
    const proc = await t.launch(t.addItem(1));
    const input = {
      questions: [
        { question: "Which color?", header: "Color", multiSelect: false, options: [{ label: "Red", description: "" }, { label: "Green", description: "" }] },
        { question: "Which sizes?", header: "Sizes", multiSelect: true, options: [{ label: "S", description: "" }, { label: "L", description: "" }] },
      ],
    };
    proc.emit({ type: "control_request", request_id: "r1", request: { subtype: "can_use_tool", tool_name: "AskUserQuestion", input } });
    const [ask] = t.asks.forItem("item-1");

    expect(() => t.runner.answer(ask!.id, { behavior: "allow" })).toThrow("answer the questions or decline");
    expect(() => t.runner.answer(ask!.id, { behavior: "allow", answers: { "Which color?": "Green" } })).toThrow("no answer for: Which sizes?");
    expect(t.asks.pending("item-1")).toHaveLength(1);

    const answers = { "Which color?": "Green", "Which sizes?": "S, L" };
    t.runner.answer(ask!.id, { behavior: "allow", answers });
    expect(proc.sent().at(-1).response.response).toEqual({ behavior: "allow", updatedInput: { ...input, answers } });
    expect(t.events.forItem("item-1").find((e) => e.type === "permission.answered")!.payload).toEqual({ behavior: "allow", rules: [], interrupt: false, answers });
  });

  it("refuses answers for an ask that is not a question", async () => {
    const t = setup();
    const proc = await t.launch(t.addItem(1));
    proc.emit({ type: "control_request", request_id: "r1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls" } } });
    const [ask] = t.asks.forItem("item-1");
    expect(() => t.runner.answer(ask!.id, { behavior: "allow", answers: { x: "y" } })).toThrow("only AskUserQuestion takes answers");
  });

  it("allows a WebFetch to a listed host itself, without asking the user", async () => {
    const t = setup(1, ["github.com"]);
    const proc = await t.launch(t.addItem(1));
    const input = { url: "https://api.github.com/repos/actions/checkout/releases/latest", prompt: "latest tag" };
    proc.emit({ type: "control_request", request_id: "r1", request: { subtype: "can_use_tool", tool_name: "WebFetch", input } });

    expect(proc.sent().at(-1)).toEqual({
      type: "control_response", response: { request_id: "r1", subtype: "success", response: { behavior: "allow", updatedInput: input } },
    });
    expect(t.state("item-1").state).toBe("running");
    const [ask] = t.asks.forItem("item-1");
    expect(ask).toMatchObject({ toolName: "WebFetch", state: "allowed" });
    const event = t.events.forItem("item-1").at(-1)!;
    expect(event).toMatchObject({ type: "permission.auto_allowed", actor: "system", refId: ask!.id, payload: { host: "api.github.com", domain: "github.com" } });
  });

  it("asks the user for a WebFetch to an unlisted host, and for other tools on a listed host", async () => {
    const t = setup(1, ["github.com"]);
    const proc = await t.launch(t.addItem(1));
    proc.emit({ type: "control_request", request_id: "r1", request: { subtype: "can_use_tool", tool_name: "WebFetch", input: { url: "https://example.com/" } } });
    proc.emit({ type: "control_request", request_id: "r2", request: { subtype: "can_use_tool", tool_name: "SandboxNetworkAccess", input: { host: "github.com" } } });
    expect(t.asks.pending("item-1").map((a) => a.toolName)).toEqual(["WebFetch", "SandboxNetworkAccess"]);
    expect(t.state("item-1").state).toBe("needs_you");
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

  it("denies and stops the turn: interrupt goes to the CLI, is recorded, and the item waits for the user after the turn ends", async () => {
    const t = setup();
    const proc = await t.launch(t.addItem(1));
    proc.emit({ type: "control_request", request_id: "r1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "curl x" } } });
    const [ask] = t.asks.forItem("item-1");
    t.runner.answer(ask!.id, { behavior: "deny", message: "Stop here.", interrupt: true });
    expect(proc.sent().at(-1).response.response).toEqual({ behavior: "deny", message: "Stop here.", interrupt: true });
    expect(t.asks.get(ask!.id)!.state).toBe("denied");
    expect(t.events.forItem("item-1").find((e) => e.type === "permission.answered")!.payload).toEqual({
      behavior: "deny", rules: [], interrupt: true,
    });
    proc.emit({ type: "result", subtype: "error_during_execution", is_error: true, result: "", num_turns: 1 });
    expect(t.types("item-1").at(-1)).toBe("agent.turn_ended");
    expect(t.state("item-1").state).toBe("needs_you");
    // No further tool call was answered or started after the interrupt.
    expect(proc.sent().filter((m) => m.type === "control_response")).toHaveLength(1);
  });

  it("records interrupt false for a plain deny", async () => {
    const t = setup();
    const proc = await t.launch(t.addItem(1));
    proc.emit({ type: "control_request", request_id: "r1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "curl x" } } });
    const [ask] = t.asks.forItem("item-1");
    t.runner.answer(ask!.id, { behavior: "deny" });
    expect(proc.sent().at(-1).response.response).toEqual({ behavior: "deny", message: "The user denied this." });
    expect(t.events.forItem("item-1").find((e) => e.type === "permission.answered")!.payload).toMatchObject({ interrupt: false });
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

  describe("stop", () => {
    it("SIGTERMs the agent and fails a running item with a reason it can be retried from", async () => {
      const t = setup();
      const proc = await t.launch(t.addItem(1));
      await t.runner.stop("item-1");
      expect(proc.signals).toEqual(["SIGTERM"]);
      expect(t.state("item-1").state).toBe("failed");
      expect(t.events.forItem("item-1").at(-1)).toMatchObject({ type: "agent.failed", payload: { reason: "stopped by you" } });
      expect(t.runner.count).toBe(0);
    });

    it("SIGKILLs an agent that ignores SIGTERM after the grace period", async () => {
      const t = setup();
      const proc = await t.launch(t.addItem(1));
      proc.exitOnSignal = false;
      await t.runner.stop("item-1", 1);
      expect(proc.signals).toEqual(["SIGTERM", "SIGKILL"]);
      expect(t.state("item-1").state).toBe("failed");
    });

    it("leaves an item that waits on the user as it is", async () => {
      const t = setup();
      const proc = await t.launch(t.addItem(1));
      proc.emit(...lines("basic.jsonl"));
      expect(t.state("item-1").state).toBe("needs_you");
      await t.runner.stop("item-1");
      expect(t.state("item-1").state).toBe("needs_you");
    });

    it("refuses when no process is alive", async () => {
      const t = setup();
      t.addItem(1);
      expect(() => t.runner.stop("item-1")).toThrow(StopError);
      t.runner.reserve("item-1");
      expect(() => t.runner.stop("item-1")).toThrow(StopError);
    });
  });

  describe("current tool", () => {
    const toolUse = (id: string, name: string, input: unknown) => ({
      type: "assistant", session_id: "s1", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
    });
    const toolResult = (id: string) => ({
      type: "user", session_id: "s1", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] },
    });

    it("is the latest call without a result, and gone when the agent exits", async () => {
      const t = setup();
      const proc = await t.launch(t.addItem(1));
      proc.emit(toolUse("t1", "Bash", { command: "pnpm test" }));
      expect(t.runner.currentTool("item-1")).toEqual({ name: "Bash", summary: "pnpm test" });
      proc.emit(toolUse("t2", "Read", { file_path: "a.ts" }));
      expect(t.runner.currentTool("item-1")).toEqual({ name: "Read", summary: "a.ts" });
      proc.emit(toolResult("t2"));
      expect(t.runner.currentTool("item-1")).toEqual({ name: "Bash", summary: "pnpm test" });
      proc.emit(toolResult("t1"));
      expect(t.runner.currentTool("item-1")).toBeUndefined();
      expect(t.activity).toEqual(["item-1", "item-1", "item-1", "item-1"]);

      proc.emit(toolUse("t3", "Bash", { command: "sleep 9" }));
      proc.exit(0);
      expect(t.runner.currentTool("item-1")).toBeUndefined();
      expect(t.activity.at(-1)).toBe("item-1");
    });
  });
});
