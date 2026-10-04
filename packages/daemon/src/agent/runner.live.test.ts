import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
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
      agentPath: () => undefined,
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

  // Issue #170: the sandbox's denyRead on ~/Library/Keychains, not the deny rules, keeps this closed.
  it.skipIf(process.platform !== "darwin")("cannot read a Keychain item, even through /usr/bin/security", async () => {
    const service = "donepm-sandbox-test";
    const account = `live-${randomBytes(4).toString("hex")}`;
    const secret = `s3cret-${randomBytes(8).toString("hex")}`;
    execFileSync("/usr/bin/security", ["add-generic-password", "-s", service, "-a", account, "-w", secret]);
    try {
      const cwd = await mkdtemp(join(tmpdir(), "donepm-live-"));
      const db = openDb(":memory:");
      const ctx = testCtx();
      const items = new ItemStore(db);
      const transcript = new TranscriptStore(db);
      const writer = itemWriter({ db, items, events: new EventStore(db), onItem: () => {}, onEvent: () => {} });
      const runner = new AgentRunner({
        items, writer, asks: new AskStore(db), transcript, ctx, log: silentLog, spawn: spawnProcess,
        push: () => {},
        agentPath: () => undefined,
        env: () => agentEnv(process.env, { shimRoot: join(cwd, ".shims"), emptyConfigDir: join(cwd, ".no-credentials") }),
        maxConcurrent: () => 1,
      });
      const playbook: Playbook = { name: "live", model: "haiku", permissionMode: "acceptEdits", drafts: [], body: "" };
      const item: WorkItem = {
        id: "live-2", source: "github-issue", externalId: "o/r#2", externalUrl: "", title: "T", body: "", labels: [],
        state: "ready", playbook: "live", priority: 1, stateSince: ctx.now(), createdAt: ctx.now(), updatedAt: ctx.now(),
      };
      items.insert(item, "github.com/o/r");
      const running = writer.commit(start(item, ctx));
      runner.reserve(item.id);
      await runner.launch({
        item: running, playbook, cwd,
        prompt: [
          "This is a sandbox test. Run exactly this one Bash command, then reply with one word: done.",
          `bash -c '/usr/bin/security find-generic-password -s ${service} -a ${account} -w; wc -c ~/Library/Keychains/login.keychain-db' > out.txt 2>&1; true`,
        ].join("\n"),
      });
      await vi.waitFor(() => expect(items.get(item.id)!.item.state).toBe("needs_you"), { timeout: 120_000, interval: 500 });
      await runner.stopAll();

      const out = await readFile(join(cwd, "out.txt"), "utf8").catch(() => "");
      expect(out).not.toContain(secret);
      expect(JSON.stringify(transcript.page(item.id))).not.toContain(secret);
    } finally {
      execFileSync("/usr/bin/security", ["delete-generic-password", "-s", service, "-a", account], { stdio: "ignore" });
    }
  }, 180_000);
});
