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

/** Runs the real `claude` with a cheap model. Costs money; only with DONEPM_LIVE=1. */
describe.skipIf(!process.env.DONEPM_LIVE)("AgentRunner (live)", () => {
  it("runs one turn, writes a file and ends in Needs You", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "donepm-live-"));
    const db = openDb(":memory:");
    const ctx = testCtx();
    const items = new ItemStore(db);
    const events = new EventStore(db);
    const transcript = new TranscriptStore(db);
    const writer = itemWriter({ db, items, events, onItem: () => {}, onEvent: () => {} });
    const runner = new AgentRunner({
      items, writer, asks: new AskStore(db), transcript, ctx, log: silentLog, spawn: spawnProcess,
      push: () => {},
      claudePath: () => "claude",
      env: () => agentEnv(process.env, { shimRoot: join(cwd, ".shims"), emptyConfigDir: join(cwd, ".no-credentials") }),
      maxConcurrent: () => 1,
    });
    const playbook: Playbook = { name: "live", model: "haiku", permissionMode: "acceptEdits", drafts: [], body: "" };
    const item: WorkItem = {
      id: "live-1", source: "github-issue", externalId: "o/r#1", externalUrl: "", title: "T", body: "", labels: [],
      state: "ready", playbook: "live", priority: 1, stateSince: ctx.now(), createdAt: ctx.now(), updatedAt: ctx.now(),
    };
    items.insert(item, "github.com/o/r");
    const running = writer.commit(start(item, ctx));

    runner.reserve(item.id);
    await runner.launch({
      item: running, playbook, cwd,
      prompt: "Create a file named out.txt containing exactly the word BATON. Then reply with one word: done.",
    });
    await vi.waitFor(() => expect(items.get(item.id)!.item.state).toBe("needs_you"), { timeout: 120_000, interval: 500 });
    await runner.stopAll();

    expect(items.get(item.id)!.item.agentSessionId).toEqual(expect.any(String));
    expect((await readFile(join(cwd, "out.txt"), "utf8")).trim()).toBe("BATON");
    expect(transcript.page(item.id).map((m) => m.kind)).toContain("result");
  }, 180_000);
});
