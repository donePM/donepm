import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start, type Playbook, type WorkItem } from "@donepm/core";
import { describe, expect, it, vi } from "vitest";
import { AskStore } from "../asks/store.js";
import { openDb } from "../db/database.js";
import { EventStore } from "../events/store.js";
import { itemWriter } from "../items/commit.js";
import { ItemStore } from "../items/store.js";
import { silentLog } from "../log.js";
import { testCtx } from "../test-support/ctx.js";
import { TranscriptStore } from "../transcript/store.js";
import { agentEnv } from "./env.js";
import { spawnProcess } from "./process.js";
import { AgentRunner } from "./runner.js";

/**
 * Runs the real `codex app-server` with the user's own Codex login. Costs money; only with
 * DONEPM_LIVE=1. The file write is approved by the test, as the user would in the UI.
 */
describe.skipIf(!process.env.DONEPM_LIVE)("AgentRunner with Codex (live)", () => {
  it("runs one turn, writes a file after approval and ends in Needs You", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "donepm-live-codex-"));
    const db = openDb(":memory:");
    const ctx = testCtx();
    const items = new ItemStore(db);
    const events = new EventStore(db);
    const asks = new AskStore(db);
    const transcript = new TranscriptStore(db);
    const writer = itemWriter({ db, items, events, onItem: () => {}, onEvent: () => {} });
    const runner = new AgentRunner({
      items, writer, asks, transcript, ctx, log: silentLog, spawn: spawnProcess,
      push: () => {},
      agentPath: () => undefined,
      env: () => agentEnv(process.env, { shimRoot: join(cwd, ".shims"), emptyConfigDir: join(cwd, ".no-credentials") }),
      maxConcurrent: () => 1,
    });
    const playbook: Playbook = { name: "live", model: "default", permissionMode: "acceptEdits", drafts: [], body: "" };
    const item: WorkItem = {
      id: "live-codex-1", source: "github-issue", externalId: "o/r#1", externalUrl: "", title: "T", body: "", labels: [],
      state: "ready", playbook: "live", priority: 1, agentKind: "codex", stateSince: ctx.now(), createdAt: ctx.now(), updatedAt: ctx.now(),
    };
    items.insert(item, "github.com/o/r");
    const running = writer.commit(start(item, ctx));

    runner.reserve(item.id);
    await runner.launch({
      item: running, playbook, cwd,
      prompt: "Create a file named out.txt containing exactly the word BATON. Then reply with one word: done.",
    });
    // Approve whatever it asks, until the turn ends.
    await vi.waitFor(() => {
      for (const ask of asks.pending(item.id)) runner.answer(ask.id, { behavior: "allow" });
      expect(items.get(item.id)!.item.state).toBe("needs_you");
      expect(asks.pending(item.id)).toEqual([]);
    }, { timeout: 180_000, interval: 500 });
    await runner.stopAll();

    expect(items.get(item.id)!.item.agentSessionId).toEqual(expect.any(String));
    expect((await readFile(join(cwd, "out.txt"), "utf8")).trim()).toBe("BATON");
    expect(events.forItem(item.id).map((e) => e.type)).toContain("agent.turn_ended");
  }, 240_000);
});
