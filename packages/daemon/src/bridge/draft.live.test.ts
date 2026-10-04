import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Playbook } from "@donepm/core";
import { describe, expect, it, vi } from "vitest";
import { agentEnv } from "../agent/env.js";
import { spawnProcess } from "../agent/process.js";
import { AgentRunner } from "../agent/runner.js";
import { AskStore } from "../asks/store.js";
import { silentLog } from "../log.js";
import { exec } from "../process/exec.js";
import { draftStores } from "../test-support/draft-stores.js";
import { TranscriptStore } from "../transcript/store.js";
import { writeMcpConfig } from "./mcp-config.js";
import { listenBridge } from "./server.js";
import { BridgeSessions } from "./sessions.js";

/** The built shim, as the daemon ships it. Run `pnpm build` first. */
const SHIM = fileURLToPath(new URL("../../dist/bridge/main.js", import.meta.url));

/** Real `claude` calling draft_pr through the real shim. Costs money; only with DONEPM_LIVE=1. */
describe.skipIf(!process.env.DONEPM_LIVE)("draft_pr (live)", () => {
  it("ends with a pending draft and the tool result in the transcript", async () => {
    expect(existsSync(SHIM)).toBe(true);
    const cwd = await mkdtemp(join(tmpdir(), "donepm-live-"));
    const t = draftStores();
    const transcript = new TranscriptStore(t.db);
    const sessions = new BridgeSessions();
    const socket = join(cwd, "mcp.sock");
    const bridge = await listenBridge({ ...t.deps, exec, sessions, log: silentLog, version: "live" }, socket);
    const runner = new AgentRunner({
      items: t.items, writer: t.deps.writer, asks: new AskStore(t.db), transcript, ctx: t.deps.ctx, log: silentLog,
      spawn: spawnProcess, push: () => {},
      claudePath: () => "claude",
      env: () => agentEnv(process.env, { shimRoot: join(cwd, ".shims"), emptyConfigDir: join(cwd, ".no-credentials") }),
      maxConcurrent: () => 1,
      mcp: (item, playbook) => {
        const token = sessions.mint({ itemId: item.id, drafts: playbook.drafts });
        const file = writeMcpConfig({ dir: cwd, itemId: item.id, nodePath: process.execPath, bridgePath: SHIM, socketPath: socket, token });
        return { configPath: file.path, close: () => file.remove() };
      },
    });
    const playbook: Playbook = { name: "live", model: "haiku", permissionMode: "acceptEdits", drafts: ["pr"], body: "" };

    runner.reserve("item-1");
    await runner.launch({
      item: t.items.get("item-1")!.item, playbook, cwd,
      prompt: 'Call the draft_pr tool of the donepm MCP server once, with title "Live check" and body "Nothing to see". Then stop.',
    });
    await vi.waitFor(() => expect(t.drafts.pending("item-1")).toHaveLength(1), { timeout: 120_000, interval: 500 });
    await vi.waitFor(
      () => expect(transcript.page("item-1").some((m) => m.kind === "tool_result" && JSON.stringify(m.raw).includes("Draft created"))).toBe(true),
      { timeout: 60_000, interval: 500 },
    );
    await runner.stopAll();
    await bridge.close();

    expect(t.drafts.pending("item-1")[0]).toMatchObject({ type: "pr", payload: { title: "Live check" } });
    expect(t.state()).toBe("needs_you");
  }, 240_000);
});
