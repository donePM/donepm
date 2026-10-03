import { execFileSync } from "node:child_process";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { runShim } from "./bridge/shim.js";
import { createDaemon, type Daemon } from "./daemon.js";
import { testCtx } from "./test-support/ctx.js";
import { fakeExec, fixture, ok } from "./test-support/fake-exec.js";
import { fakeProcesses } from "./test-support/fake-process.js";
import { cloneWithOrigin, git } from "./test-support/git-repo.js";
import { exec as realExec, type Exec } from "./process/exec.js";

let daemon: Daemon | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  await daemon?.stop();
  daemon = undefined;
});

/** Real git for repo discovery, recorded gh output for everything else. */
function execWith(search: () => string): Exec {
  const gh = fakeExec({
    "which gh": ok("/opt/homebrew/bin/gh\n"),
    "gh auth status": ok(fixture("gh/auth-status-ok.stdout")),
    "gh search issues": () => ok(search()),
    "gh issue view": ok(fixture("gh/issue-view-open.json")),
    "which claude": ok("/usr/local/bin/claude\n"),
    "claude --version": ok("2.1.288 (Claude Code)\n"),
    "claude auth status": ok(fixture("claude/auth-status-logged-in.json")),
    "gh pr create": ok("https://github.com/acme/widgets/pull/200\n"),
  });
  return (cmd, args, opts) => {
    // origin points at github.com; the clone already has origin/main, so fetching is skipped.
    if (cmd === "git" && args.includes("fetch")) return Promise.resolve(ok(""));
    // Nothing leaves the machine in tests.
    if (cmd === "git" && args.includes("push")) return Promise.resolve(ok(""));
    return cmd === "git" || cmd === "sh" ? realExec(cmd, args, opts) : gh(cmd, args, opts);
  };
}

async function home(): Promise<string> {
  const h = await mkdtemp(join(tmpdir(), "donepm-home-"));
  const clone = join(h, "Code", "acme", "widgets");
  await mkdir(clone, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: clone });
  execFileSync("git", ["remote", "add", "origin", "git@github.com:acme/widgets.git"], { cwd: clone });
  return h;
}

/** Like `home`, but the clone has a commit, `origin/main` and a setup file. */
async function homeWithHistory(): Promise<string> {
  const h = await mkdtemp(join(tmpdir(), "donepm-home-"));
  const { clone } = await cloneWithOrigin({ ".donepm/setup.yml": "copy: [.env]\nrun: [\"echo ready\"]\n" }, join(h, "Code"));
  git(clone, "remote", "set-url", "origin", "git@github.com:acme/widgets.git");
  await writeFile(join(clone, ".env"), "SECRET=1");
  return h;
}

async function start(
  h: string,
  search = () => fixture("gh/search-issues.json"),
  publicDir = join(h, "no-ui"),
  spawn = fakeProcesses(),
): Promise<Daemon> {
  daemon = await createDaemon({
    home: h, exec: execWith(search), ctx: testCtx(), version: "0.0.0-test", port: 0, publicDir, spawn,
    env: { PATH: "/usr/bin:/bin", GH_TOKEN: "secret" },
  });
  await daemon.start();
  await daemon.pollNow();
  return daemon;
}

/**
 * Starts #161 and lets the fake agent call `draft_pr` through the real shim, the way `claude`
 * would with --mcp-config. Returns once the agent's turn ended on the draft.
 */
async function agentDrafts(d: Daemon, spawn: ReturnType<typeof fakeProcesses>, draft = { title: "Fix search", body: "Closes #161" }) {
  const item = (await get(d, "/api/items")).body.find((i: any) => i.externalId === "acme/widgets#161");
  await get(d, `/api/items/${item.id}/start`, { method: "POST" });
  await vi.waitFor(() => expect(spawn.spawned).toHaveLength(1));
  const proc = spawn.last();

  const configPath = proc.args[proc.args.indexOf("--mcp-config") + 1]!;
  const server = JSON.parse(await readFile(configPath, "utf8")).mcpServers.donepm;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const replies: any[] = [];
  let buf = "";
  stdout.on("data", (c) => {
    buf += c.toString();
    for (let nl = buf.indexOf("\n"); nl !== -1; nl = buf.indexOf("\n")) {
      replies.push(JSON.parse(buf.slice(0, nl)));
      buf = buf.slice(nl + 1);
    }
  });
  const shim = runShim({ env: server.env, stdin, stdout, stderr: new PassThrough() });
  const rpc = (msg: object) => stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
  rpc({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude", version: "x" } } });
  rpc({ method: "notifications/initialized" });
  rpc({ id: 2, method: "tools/call", params: { name: "draft_pr", arguments: draft } });
  await vi.waitFor(() => expect(replies.find((r) => r.id === 2)).toBeDefined());
  const text: string = replies.find((r) => r.id === 2).result.content[0].text;

  proc.emit(
    { type: "assistant", session_id: "s1", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "mcp__donepm__draft_pr", input: { title: draft.title } }] } },
    { type: "user", session_id: "s1", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text }] }] } },
    { type: "result", subtype: "success", is_error: false, session_id: "s1", total_cost_usd: 0.1 },
  );
  return { item, proc, configPath, server, stdin, shim, text };
}

async function get(d: Daemon, path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(d.address() + path, init);
  return { status: res.status, body: await res.json() };
}

describe("daemon", () => {
  it("creates the config on first start and serves polled items", async () => {
    const h = await home();
    const d = await start(h);
    expect(JSON.parse(await readFile(join(h, ".config/donepm/config.json"), "utf8")).port).toBe(6174);

    const { status, body } = await get(d, "/api/items");
    expect(status).toBe(200);
    expect(body.map((i: any) => [i.externalId, i.state, i.badges])).toEqual([
      ["acme/widgets#161", "ready", []],
      ["acme/widgets#157", "ready", []],
      ["solo/tool#61", "ready", ["no-local-clone"]],
      ["Acme/API#12", "ready", ["no-local-clone"]],
    ]);
    expect(body[0].repo.path).toBe(join(h, "Code", "acme", "widgets"));
  });

  it("returns one item with events, drafts and asks, and 404 for unknown ids", async () => {
    const d = await start(await home());
    const [first] = (await get(d, "/api/items")).body;
    const { body } = await get(d, `/api/items/${first.id}`);
    expect(body.events.map((e: any) => e.type)).toEqual(["item.collected"]);
    expect(body.drafts).toEqual([]);
    expect(body.asks).toEqual([]);
    expect((await get(d, "/api/items/nope")).status).toBe(404);
  });

  it("lists and rescans repos, linking items to new clones", async () => {
    const h = await home();
    const d = await start(h);
    expect((await get(d, "/api/repos")).body.map((r: any) => r.originUrl)).toEqual(["github.com/acme/widgets"]);

    const clone = join(h, "Code", "solo", "tool");
    await mkdir(clone, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: clone });
    execFileSync("git", ["remote", "add", "origin", "https://github.com/solo/tool"], { cwd: clone });
    const rescan = await get(d, "/api/repos/rescan", { method: "POST" });
    expect(rescan.body.map((r: any) => r.originUrl)).toEqual(["github.com/acme/widgets", "github.com/solo/tool"]);
    const item = (await get(d, "/api/items")).body.find((i: any) => i.externalId === "solo/tool#61");
    expect(item.badges).toEqual([]);
  });

  it("reports status", async () => {
    const d = await start(await home());
    const { body } = await get(d, "/api/status");
    expect(body).toMatchObject({
      version: "0.0.0-test",
      gh: { state: "ready", account: "octocat" },
      claude: { state: "ready", version: "2.1.288" },
      lastPoll: { ok: true, issues: 4 },
      runningAgents: 0,
    });
    expect(body.lastScan).toEqual(expect.any(String));
  });

  it("detects the CLIs again on recheck", async () => {
    const d = await start(await home());
    const { status, body } = await get(d, "/api/status/recheck", { method: "POST" });
    expect(status).toBe(200);
    expect(body).toMatchObject({ gh: { state: "ready" }, claude: { state: "ready" } });
  });

  it("serves the web UI with a fallback to index.html for client routes", async () => {
    const h = await home();
    const ui = join(h, "public");
    await mkdir(join(ui, "assets"), { recursive: true });
    await writeFile(join(ui, "index.html"), "<!doctype html><title>donePM</title>");
    await writeFile(join(ui, "assets", "app.js"), "console.log(1)");
    const d = await start(h, undefined, ui);

    const root = await fetch(d.address() + "/");
    expect(root.headers.get("content-type")).toMatch(/text\/html/);
    expect(await root.text()).toContain("<title>donePM</title>");
    expect(await (await fetch(d.address() + "/assets/app.js")).text()).toBe("console.log(1)");
    expect(await (await fetch(d.address() + "/settings")).text()).toContain("<title>donePM</title>");
    expect((await get(d, "/api/nope")).status).toBe(404);

    // A rebuild writes new hashed assets while the daemon runs.
    await writeFile(join(ui, "assets", "app-2.js"), "console.log(2)");
    expect(await (await fetch(d.address() + "/assets/app-2.js")).text()).toBe("console.log(2)");
  });

  it("answers 404 at / when the UI is not built", async () => {
    const d = await start(await home());
    expect((await fetch(d.address() + "/")).status).toBe(404);
  });

  it("reads and updates settings, persisting them", async () => {
    const h = await home();
    const d = await start(h);
    expect((await get(d, "/api/settings")).body.branchPrefix).toBe("dp/");
    const put = await get(d, "/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ branchPrefix: "rk/", port: 7000 }),
    });
    expect(put.body).toMatchObject({ settings: { branchPrefix: "rk/", port: 7000 }, restartRequired: true });
    expect(JSON.parse(await readFile(join(h, ".config/donepm/config.json"), "utf8")).branchPrefix).toBe("rk/");

    const bad = await get(d, "/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pollIntervalSeconds: 1, nope: true }),
    });
    expect(bad.status).toBe(400);
  });

  it("rejects requests from foreign origins", async () => {
    const d = await start(await home());
    const res = await fetch(d.address() + "/api/items", { headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });

  it("pushes item.updated over the websocket when a poll changes an item", async () => {
    let out = fixture("gh/search-issues.json");
    const d = await start(await home(), () => out);
    const ws = new WebSocket(d.address().replace("http", "ws") + "/ws");
    await new Promise((r) => ws.once("open", r));
    const messages: any[] = [];
    const statusPushed = new Promise<void>((resolve) =>
      ws.on("message", (m) => {
        const msg = JSON.parse(String(m));
        messages.push(msg);
        // The poll pushes item updates first and the poll status last.
        if (msg.type === "status.changed" && msg.payload.lastPoll) resolve();
      }),
    );

    const changed = JSON.parse(out);
    changed[0].title = "Renamed";
    out = JSON.stringify(changed);
    await d.pollNow();
    await statusPushed;
    ws.close();

    const updates = messages.filter((m) => m.type === "item.updated");
    expect(updates.map((m) => m.payload.title)).toEqual(["Renamed"]);
  });

  it("refuses websocket upgrades from foreign origins", async () => {
    const d = await start(await home());
    const ws = new WebSocket(d.address().replace("http", "ws") + "/ws", { origin: "https://evil.example" });
    const err = await new Promise<Error>((r) => ws.once("error", r));
    expect(err.message).toMatch(/403/);
  });

  it("keeps items across restarts", async () => {
    const h = await home();
    await start(h);
    await daemon!.stop();
    daemon = undefined;
    const d = await start(h, () => fixture("gh/search-issues-empty.json"));
    expect((await get(d, "/api/items")).body).toHaveLength(4);
  });

  it("starts an agent: worktree, setup, claude in the worktree, transcript stored", async () => {
    const h = await homeWithHistory();
    const spawn = fakeProcesses();
    const d = await start(h, undefined, undefined, spawn);
    expect(await readFile(join(h, ".config/donepm/playbooks/implement.md"), "utf8")).toMatch(/name: implement/);
    const item = (await get(d, "/api/items")).body.find((i: any) => i.externalId === "acme/widgets#161");

    const started = await get(d, `/api/items/${item.id}/start`, { method: "POST" });
    expect(started.status).toBe(202);
    expect(started.body.state).toBe("running");
    await vi.waitFor(() => expect(spawn.spawned).toHaveLength(1));

    const proc = spawn.last();
    const stored = (await get(d, `/api/items/${item.id}`)).body;
    expect(stored.branch).toMatch(/^dp\/161-/);
    expect(proc.opts.cwd).toBe(stored.worktreePath);
    expect(stored.worktreePath.startsWith(join(h, ".local/share/donepm/worktrees/acme-widgets/"))).toBe(true);
    expect(await readFile(join(stored.worktreePath, ".env"), "utf8")).toBe("SECRET=1");
    expect(proc.opts.env.GH_TOKEN).toBeUndefined();
    expect(proc.args).toEqual(expect.arrayContaining(["--model", "opus", "--permission-mode", "acceptEdits"]));
    expect(proc.sent()[0].message.content[0].text).toContain(`branch\n\`${stored.branch}\``);

    proc.emit(...fixture("stream/basic.jsonl").split("\n").filter(Boolean));
    const transcript = (await get(d, `/api/items/${item.id}/transcript`)).body;
    expect(transcript.slice(0, 3).map((m: any) => [m.kind, m.raw.step])).toEqual([
      ["system", "copy"], ["system", "run"], ["user", undefined],
    ]);
    expect(transcript.at(-1).kind).toBe("result");
    const after = (await get(d, `/api/items/${item.id}/transcript?after=${transcript[1].id}`)).body;
    expect(after).toHaveLength(transcript.length - 2);
    expect((await get(d, `/api/items/${item.id}`)).body.state).toBe("needs_you");
    expect((await get(d, "/api/status")).body.runningAgents).toBe(1);
  });

  it("shows agent info on the item and stops the agent over HTTP", async () => {
    const spawn = fakeProcesses();
    const d = await start(await homeWithHistory(), undefined, undefined, spawn);
    const item = (await get(d, "/api/items")).body.find((i: any) => i.externalId === "acme/widgets#161");
    expect(item.agent).toEqual({ running: false });
    expect((await get(d, `/api/items/${item.id}/stop`, { method: "POST" })).status).toBe(409);

    await get(d, `/api/items/${item.id}/start`, { method: "POST" });
    await vi.waitFor(() => expect(spawn.spawned).toHaveLength(1));
    spawn.last().emit({
      type: "assistant", session_id: "s1",
      message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "pnpm test" } }] },
    });
    const running = (await get(d, `/api/items/${item.id}`)).body;
    expect(running.agent).toMatchObject({ running: true, startedAt: expect.any(String), currentTool: { name: "Bash", summary: "pnpm test" } });

    const stopped = await get(d, `/api/items/${item.id}/stop`, { method: "POST" });
    expect(stopped.status).toBe(200);
    expect(stopped.body).toMatchObject({ state: "failed", agent: { running: false } });
    expect(stopped.body.agent.currentTool).toBeUndefined();
    expect(spawn.last().signals).toEqual(["SIGTERM"]);
    expect((await get(d, "/api/items/nope/stop", { method: "POST" })).status).toBe(404);
  });

  it("refuses to start twice, items without a clone, and a second agent", async () => {
    const d = await start(await homeWithHistory());
    const items = (await get(d, "/api/items")).body;
    const [a, b] = items.filter((i: any) => i.externalId.startsWith("acme/widgets"));
    const noClone = items.find((i: any) => i.externalId === "solo/tool#61");
    expect((await get(d, `/api/items/${a.id}/start`, { method: "POST" })).status).toBe(202);
    expect((await get(d, `/api/items/${a.id}/start`, { method: "POST" })).body).toEqual({ error: "item is running" });
    expect((await get(d, `/api/items/${b.id}/start`, { method: "POST" })).body.error).toMatch(/already running/);
    expect((await get(d, `/api/items/${noClone.id}/start`, { method: "POST" })).status).toBe(409);
    expect((await get(d, "/api/items/nope/start", { method: "POST" })).status).toBe(404);
  });

  it("fails the item when setup fails, with the output in the transcript", async () => {
    const h = await homeWithHistory();
    await (await import("node:fs/promises")).rm(join(h, "Code", "acme", "widgets", ".env"));
    const spawn = fakeProcesses();
    const d = await start(h, undefined, undefined, spawn);
    const item = (await get(d, "/api/items")).body.find((i: any) => i.externalId === "acme/widgets#161");
    await get(d, `/api/items/${item.id}/start`, { method: "POST" });
    await vi.waitFor(async () => expect((await get(d, `/api/items/${item.id}`)).body.state).toBe("failed"));
    expect(spawn.spawned).toHaveLength(0);
    const detail = (await get(d, `/api/items/${item.id}`)).body;
    expect(detail.events.at(-1).payload.reason).toBe("worktree setup failed");
    expect((await get(d, `/api/items/${item.id}/transcript`)).body.map((m: any) => m.raw.ok)).toEqual([false]);
    expect((await get(d, "/api/status")).body.runningAgents).toBe(0);
  });

  it("answers a permission ask over HTTP", async () => {
    const spawn = fakeProcesses();
    const d = await start(await homeWithHistory(), undefined, undefined, spawn);
    const item = (await get(d, "/api/items")).body.find((i: any) => i.externalId === "acme/widgets#161");
    await get(d, `/api/items/${item.id}/start`, { method: "POST" });
    await vi.waitFor(() => expect(spawn.spawned).toHaveLength(1));
    spawn.last().emit({ type: "control_request", request_id: "r1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "curl x" } } });
    const [ask] = (await get(d, `/api/items/${item.id}`)).body.asks;

    const post = (body: unknown) =>
      get(d, `/api/asks/${ask.id}/answer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await post({ behavior: "maybe" })).status).toBe(400);
    expect((await post({ behavior: "deny", message: "no" })).body).toEqual({ ok: true });
    expect(spawn.last().sent().at(-1).response).toMatchObject({ request_id: "r1", response: { behavior: "deny", message: "no" } });
    expect((await post({ behavior: "allow" })).status).toBe(409);
    expect((await get(d, "/api/asks/nope/answer", { method: "POST", headers: { "content-type": "application/json" }, body: "{\"behavior\":\"allow\"}" })).status).toBe(404);
  });

  it("approving a draft commits leftovers, opens the PR and moves the item to Done", async () => {
    vi.stubEnv("GIT_AUTHOR_NAME", "t");
    vi.stubEnv("GIT_AUTHOR_EMAIL", "t@t");
    vi.stubEnv("GIT_COMMITTER_NAME", "t");
    vi.stubEnv("GIT_COMMITTER_EMAIL", "t@t");
    const spawn = fakeProcesses();
    const d = await start(await homeWithHistory(), undefined, undefined, spawn);
    const { item, proc, stdin, shim } = await agentDrafts(d, spawn);
    const detail = (await get(d, `/api/items/${item.id}`)).body;
    writeFileSync(join(detail.worktreePath, "fix.txt"), "fixed\n");

    const res = await get(d, `/api/drafts/${detail.drafts[0].id}/approve`, { method: "POST" });
    expect(res.body).toMatchObject({ state: "executed", result: { url: "https://github.com/acme/widgets/pull/200", number: 200 } });
    expect(git(detail.worktreePath, "log", "-1", "--format=%s").trim()).toBe("WIP from donePM");
    // Setup's copy of .env is left out of the commit.
    expect(git(detail.worktreePath, "show", "--name-only", "--format=", "HEAD").trim()).toBe("fix.txt");
    expect(git(detail.worktreePath, "status", "--porcelain").trim()).toBe("?? .env");
    const after = (await get(d, `/api/items/${item.id}`)).body;
    expect(after).toMatchObject({ state: "done", pr: { number: 200 } });
    expect(after.attention).toBeUndefined();
    expect(after.events.map((e: any) => e.type).slice(-2)).toEqual(["draft.approved", "draft.executed"]);
    // The agent's work is published; its process is ended, the item stays done.
    expect(proc.signals).toEqual(["SIGTERM"]);
    expect((await get(d, `/api/drafts/${detail.drafts[0].id}/approve`, { method: "POST" })).status).toBe(409);
    stdin.end();
    await shim;
  });

  it("draft_pr end to end: the agent's MCP call makes a pending draft, the user edits and rejects it", async () => {
    const spawn = fakeProcesses();
    const d = await start(await homeWithHistory(), undefined, undefined, spawn);
    const { item, proc, configPath, server, stdin, shim, text } = await agentDrafts(d, spawn);
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
    expect(server.command).toBe(process.execPath);
    expect(text).toBe("Draft created, the user will review it.");

    let detail = (await get(d, `/api/items/${item.id}`)).body;
    expect(detail.state).toBe("needs_you");
    expect(detail.drafts).toMatchObject([{ type: "pr", state: "pending", payload: { title: "Fix search", body: "Closes #161", base: "main" } }]);
    const transcript = (await get(d, `/api/items/${item.id}/transcript`)).body;
    expect(transcript.some((m: any) => m.kind === "tool_result" && JSON.stringify(m.raw).includes("Draft created"))).toBe(true);

    const post = (path: string, body: unknown) =>
      get(d, path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const draftId = detail.drafts[0].id;
    // The board card knows what to show without loading the detail.
    expect(detail.attention).toEqual({ kind: "draft", draftId, title: "Fix search" });
    writeFileSync(join(detail.worktreePath, "fix.txt"), "fixed\n");
    const diff = (await get(d, `/api/items/${item.id}/diff`)).body;
    expect(diff).toMatchObject({ base: "origin/main", branch: detail.branch, commits: 0 });
    expect(diff.patch).toContain("+++ b/fix.txt");
    expect((await post(`/api/items/${item.id}/open`, { target: "browser" })).status).toBe(400);
    expect((await post(`/api/drafts/${draftId}/edit`, { payload: { title: "" } })).status).toBe(400);
    expect((await post(`/api/drafts/${draftId}/edit`, { payload: { title: "Fix the search" } })).body.userEdits.title).toBe("Fix the search");
    expect((await post(`/api/drafts/${draftId}/reject`, { reason: "Add a test" })).body.state).toBe("rejected");
    expect(proc.sent().at(-1).message.content[0].text).toContain("Add a test");
    detail = (await get(d, `/api/items/${item.id}`)).body;
    expect(detail.state).toBe("running");
    expect(detail.attention).toBeUndefined();
    expect(detail.events.map((e: any) => e.type).slice(-3)).toEqual(["draft.created", "draft.edited", "draft.rejected"]);
    expect((await post(`/api/drafts/${draftId}/reject`, {})).status).toBe(409);
    expect((await post("/api/drafts/nope/edit", { payload: {} })).status).toBe(404);

    // The process ends: its token and config file go with it.
    proc.exit(0);
    expect(existsSync(configPath)).toBe(false);
    stdin.end();
    expect(await shim).toBe(0);
  });
});
