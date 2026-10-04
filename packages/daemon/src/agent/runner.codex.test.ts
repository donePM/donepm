import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start, type Playbook, type WorkItem } from "@donepm/core";
import { describe, expect, it } from "vitest";
import { GrantStore } from "../asks/grants.js";
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
import { AgentRunner } from "./runner.js";

const playbook: Playbook = { name: "implement", model: "gpt-5.5", permissionMode: "acceptEdits", drafts: ["pr"], body: "" };
const lines = (name: string) => fixture(`codex/${name}`).split("\n").filter((l) => l.trim() !== "");

async function setup() {
  const db = openDb(":memory:");
  const ctx = testCtx();
  const items = new ItemStore(db);
  const events = new EventStore(db);
  const asks = new AskStore(db);
  const transcript = new TranscriptStore(db);
  const spawn = fakeProcesses();
  const bridgeDir = await mkdtemp(join(tmpdir(), "donepm-bridge-"));
  const closed: string[] = [];
  const writer = itemWriter({ db, items, events, onItem: () => {}, onEvent: () => {} });
  const runner = new AgentRunner({
    items, writer, asks, grants: new GrantStore(db), transcript, ctx, log: silentLog, spawn, push: () => {},
    agentPath: (kind) => (kind === "codex" ? "/opt/homebrew/bin/codex" : undefined),
    env: async () => ({ PATH: "/filtered" }),
    maxConcurrent: () => 1,
    mcp: () => ({
      server: { command: "/usr/bin/node", args: ["shim.js"], env: { DONEPM_SOCKET: "/sock", DONEPM_TOKEN: "tok-123" }, dir: bridgeDir },
      close: () => closed.push("closed"),
    }),
  });
  const item: WorkItem = {
    id: "item-1", source: "github-issue", externalId: "o/r#1", externalUrl: "https://github.com/o/r/issues/1",
    title: "T", body: "", labels: [], state: "ready", playbook: "implement", priority: 1, agentKind: "codex",
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
  return { runner, asks, events, transcript, launch, state, closed };
}

describe("AgentRunner with Codex", () => {
  it("runs a turn through app-server, asks, and ends in Needs You with tokens but no price", async () => {
    const t = await setup();
    const proc = await t.launch();
    expect(proc.cmd).toBe("/opt/homebrew/bin/codex");
    expect(proc.args.slice(0, 3)).toEqual(["app-server", "--listen", "stdio://"]);
    expect(proc.args.join(" ")).not.toContain("tok-123");
    expect(proc.sent().map((m) => m.method)).toEqual(["initialize"]);

    const all = lines("command-approval.ndjson");
    proc.emit(...all.slice(0, 10));
    expect(proc.sent().map((m) => m.method ?? "result")).toEqual(["initialize", "initialized", "thread/start", "turn/start"]);
    expect(t.state().agentSessionId).toBe("th-cmd");
    expect(t.state().state).toBe("needs_you");
    const [ask] = t.asks.pending("item-1");
    expect(ask).toMatchObject({ agentKind: "codex", requestId: "call_rm:0", subject: { kind: "command", command: "rm -rf build" } });

    // "Allow for this run" is Codex's acceptForSession; "Always allow" needs rules Codex has not.
    expect(() => t.runner.answer(ask!.id, { behavior: "allow", scope: "always" })).toThrow("always allow is not available");
    t.runner.answer(ask!.id, { behavior: "allow", scope: "run" });
    expect(proc.sent().at(-1)).toEqual({ id: 0, result: { decision: "acceptForSession" } });
    expect(t.state().state).toBe("running");

    // gh is declined by donePM without a question.
    proc.emit(...all.slice(10, 15));
    expect(t.asks.pending("item-1")).toEqual([]);
    expect(proc.sent().at(-2)).toEqual({ id: 1, result: { decision: "decline" } });
    expect(proc.sent().at(-1)).toMatchObject({ method: "turn/steer" });

    proc.emit(...all.slice(15));
    expect(t.state().state).toBe("needs_you");
    const ended = t.events.forItem("item-1").at(-1)!;
    expect(ended.type).toBe("agent.turn_ended");
    expect(ended.payload).toEqual({
      subtype: "completed", isError: false,
      usage: { inputTokens: 1200, outputTokens: 10, cacheReadInputTokens: 800, cacheWriteInputTokens: 0, reasoningTokens: 4 },
    });
    expect(t.transcript.page("item-1").map((m) => m.kind)).toContain("assistant_text");

    proc.exit(0);
    expect(t.state().state).toBe("needs_you");
    expect(t.closed).toEqual(["closed"]);
  });

  it("sends a later message into the same process as a new turn", async () => {
    const t = await setup();
    const proc = await t.launch();
    const all = lines("command-approval.ndjson");
    proc.emit(...all.slice(0, 5), all.at(-1)!);
    expect(t.state().state).toBe("needs_you");
    t.runner.say("item-1", "Now add a test");
    expect(proc.sent().at(-1)).toMatchObject({ id: 4, method: "turn/start", params: { threadId: "th-cmd", input: [{ type: "text", text: "Now add a test" }] } });
    proc.emit({ id: 4, result: { turn: { id: "tu-2", status: "inProgress" } } }, { method: "turn/started", params: { threadId: "th-cmd", turn: { id: "tu-2" } } });
    expect(t.state().state).toBe("running");
  });

  it("asks the turn to stop before signalling the process", async () => {
    const t = await setup();
    const proc = await t.launch();
    const all = lines("command-approval.ndjson");
    proc.emit(...all.slice(0, 5));
    await t.runner.stop("item-1");
    expect(proc.sent().at(-1)).toEqual({ id: 4, method: "turn/interrupt", params: { threadId: "th-cmd", turnId: "tu-1" } });
    expect(proc.signals).toEqual(["SIGTERM"]);
  });

  it("resumes the thread in a new process", async () => {
    const t = await setup();
    const proc = await t.launch("01a02144-3b7e-7233-97f2-73ebd5105085");
    proc.emit(lines("resume-interrupt.ndjson")[0]!);
    expect(proc.sent()[2]).toMatchObject({ method: "thread/resume", params: { threadId: "01a02144-3b7e-7233-97f2-73ebd5105085" } });
  });
});
