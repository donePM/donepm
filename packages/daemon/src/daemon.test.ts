import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import { parsePlaybook } from "@donepm/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { runShim } from "./bridge/shim.js";
import { createDaemon, type Daemon } from "./daemon.js";
import { testCtx } from "./test-support/ctx.js";
import { fakeExec, fixture, ok } from "./test-support/fake-exec.js";
import { fakeProcesses } from "./test-support/fake-process.js";
import { cloneWithOrigin, git } from "./test-support/git-repo.js";
import { exec as realExec, type Exec } from "./process/exec.js";

/**
 * Starting an item creates a real git worktree before the fake agent is spawned. On a busy CI
 * runner (other packages' tests run in parallel) that takes longer than `vi.waitFor`'s default
 * second (#61), so these waits get room. They return as soon as the condition holds.
 */
const waitFor = <T>(fn: () => T) => vi.waitFor(fn, { timeout: 10_000 });

let daemon: Daemon | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  await daemon?.stop();
  daemon = undefined;
});

/** Real git for repo discovery, recorded gh output for everything else. */
function execWith(search: () => string, view = () => fixture("gh/issue-view-open.json")): Exec {
  const gh = fakeExec({
    "which gh": ok("/opt/homebrew/bin/gh\n"),
    "gh auth status": ok(fixture("gh/auth-status-ok.stdout")),
    "gh search issues": () => ok(search()),
    "gh search prs": ok("[]"),
    "gh issue view": () => ok(view()),
    "gh issue list": ok(JSON.stringify([
      { number: 200, title: "Unassigned bug", body: "", labels: [], url: "https://github.com/acme/widgets/issues/200", createdAt: "2026-09-01T00:00:00Z" },
    ])),
    "gh issue edit": ok("https://github.com/acme/widgets/issues/161\n"),
    "which claude": ok("/usr/local/bin/claude\n"),
    "claude --version": ok("2.1.288 (Claude Code)\n"),
    "claude auth status": ok(fixture("claude/auth-status-logged-in.json")),
    "which playwright-cli": ok("/opt/homebrew/bin/playwright-cli\n"),
    "playwright-cli --version": ok("0.1.1\n"),
    "gh pr create": ok("https://github.com/acme/widgets/pull/200\n"),
    "gh pr checks": { code: 1, stdout: fixture("gh/pr-checks-fail.json"), stderr: "" },
    "gh run view": ok(fixture("gh/run-view-log-failed.txt")),
    // A clone the way gh leaves it: origin on github.com. No network (issue #37).
    "gh repo clone": ({ args }) => {
      const [, , slug, target] = args as [string, string, string, string];
      if (slug === "acme/api") return { code: 1, stdout: "", stderr: "GraphQL: Could not resolve to a Repository with the name 'acme/api'.\n" };
      execFileSync("git", ["init", "-q", target]);
      execFileSync("git", ["-C", target, "remote", "add", "origin", `git@github.com:${slug}.git`]);
      return ok("");
    },
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

/** The repositories of the recorded searches, managed (D46) unless a test wrote its own config. */
const FIXTURE_SOURCES = Object.fromEntries(
  ["github.com/acme/widgets", "github.com/acme/api", "github.com/solo/tool"].map((o) => [o, { assignOnStart: false, managed: true }]),
);

function manageFixtureRepos(h: string) {
  const file = join(h, ".config/donepm/config.json");
  if (existsSync(file)) return;
  mkdirSync(join(h, ".config/donepm"), { recursive: true });
  writeFileSync(file, JSON.stringify({ sources: FIXTURE_SOURCES }));
}

async function start(
  h: string,
  search = () => fixture("gh/search-issues.json"),
  publicDir = join(h, "no-ui"),
  spawn = fakeProcesses(),
  view?: () => string,
): Promise<Daemon> {
  manageFixtureRepos(h);
  daemon = await createDaemon({
    home: h, exec: execWith(search, view), ctx: testCtx(), version: "0.0.0-test", port: 0, publicDir, spawn,
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
  await waitFor(() => expect(spawn.spawned).toHaveLength(1));
  const proc = spawn.last();
  proc.emit({ type: "system", subtype: "init", session_id: "s1" });

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
  await waitFor(() => expect(replies.find((r) => r.id === 2)).toBeDefined());
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

describe("daemon", { timeout: 30_000 }, () => {
  it("serves polled items", async () => {
    const h = await home();
    const d = await start(h);

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

  it("clones a missing repository from the board and links its items without a rescan", async () => {
    const h = await home();
    const d = await start(h);
    const target = join(h, "Code", "solo", "tool");
    const tool = () => get(d, "/api/items").then((r) => r.body.find((i: any) => i.externalId === "solo/tool#61"));
    expect((await tool()).clone).toEqual({ origin: "github.com/solo/tool", target });
    expect((await get(d, "/api/items")).body.find((i: any) => i.externalId === "acme/widgets#161").clone).toBeUndefined();

    const ws = new WebSocket(d.address().replace("http", "ws") + "/ws");
    await new Promise((r) => ws.once("open", r));
    const pushed: string[] = [];
    ws.on("message", (m) => {
      const msg = JSON.parse(String(m));
      if (msg.type.startsWith("repo.")) pushed.push(msg.type);
    });

    const post = (origin: unknown) =>
      get(d, "/api/repos/clone", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ origin }) });
    const res = await post("github.com/solo/tool");
    expect(res).toEqual({ status: 202, body: { origin: "github.com/solo/tool", path: target, result: "started" } });
    await waitFor(async () => expect((await tool()).badges).toEqual([]));
    const item = await tool();
    expect(item.repo.path).toBe(target);
    expect(item.clone).toBeUndefined();
    await waitFor(() => expect(pushed).toEqual(["repo.cloning", "repo.cloned"]));
    ws.close();

    expect((await post("github.com/solo/tool")).status).toBe(409);
    expect((await post("gitlab.com/solo/tool")).status).toBe(400);
    expect((await post(42)).status).toBe(400);
  });

  it("refuses an occupied clone target and shows a failed clone on the card", async () => {
    const h = await home();
    const d = await start(h);
    const api = () => get(d, "/api/items").then((r) => r.body.find((i: any) => i.externalId === "Acme/API#12"));
    const post = () =>
      get(d, "/api/repos/clone", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ origin: "github.com/acme/api" }) });

    const target = join(h, "Code", "acme", "api");
    await mkdir(target);
    await writeFile(join(target, "notes.txt"), "mine");
    expect(await post()).toEqual({ status: 409, body: { error: `${target} is a folder with files in it, not a clone` } });
    expect(await readFile(join(target, "notes.txt"), "utf8")).toBe("mine");

    await rm(join(target, "notes.txt"));
    expect((await post()).status).toBe(202);
    await waitFor(async () => expect((await api()).clone.error).toBe("GraphQL: Could not resolve to a Repository with the name 'acme/api'."));
    expect((await api()).badges).toEqual(["no-local-clone"]);
    expect((await get(d, "/api/repos")).body.map((r: any) => r.originUrl)).toEqual(["github.com/acme/widgets"]);
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

  it("describes itself, its playbooks and worktrees per repository for Settings (#127)", async () => {
    const h = await home();
    const d = await start(h);
    const info = (await get(d, "/api/daemon")).body;
    expect(info).toMatchObject({
      version: "0.0.0-test",
      service: "manual",
      dbFile: join(h, ".local/share/donepm/donepm.db"),
      playbooksDir: join(h, ".config/donepm/playbooks"),
    });
    expect(info.dbBytes).toBeGreaterThan(0);
    expect(info.logFile).toBeUndefined();
    expect((await get(d, "/api/status")).body.startedAt).toBe(info.startedAt);
    const post = (path: string, body?: object) =>
      get(d, path, { method: "POST", ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
    expect((await post("/api/daemon/restart")).status).toBe(409);
    expect((await post("/api/daemon/open", { what: "logs" })).status).toBe(409);

    const { body } = await get(d, "/api/playbooks");
    expect(body.globalDir).toBe(join(h, ".config/donepm/playbooks"));
    expect(body.playbooks.map((p: any) => [p.name, p.scope.kind])).toEqual([["implement", "global"], ["review", "global"]]);
    expect((await get(d, "/api/repos")).body.map((r: any) => r.worktrees)).toEqual([0]);
  });

  it("restarts through launchd when it runs as a service (#127)", async () => {
    const h = await home();
    manageFixtureRepos(h);
    const restart = vi.fn();
    daemon = await createDaemon({
      home: h, exec: execWith(() => fixture("gh/search-issues.json")), ctx: testCtx(), version: "0.0.0-test", port: 0,
      publicDir: join(h, "no-ui"), service: { logFile: join(h, "daemon.log"), restart },
    });
    await daemon.start();
    expect((await get(daemon, "/api/daemon")).body).toMatchObject({ service: "launchd", logFile: join(h, "daemon.log") });
    expect((await get(daemon, "/api/daemon/restart", { method: "POST" })).status).toBe(202);
    await waitFor(() => expect(restart).toHaveBeenCalledOnce());
  });

  it("detects the CLIs again on recheck", async () => {
    const d = await start(await home());
    const { status, body } = await get(d, "/api/status/recheck", { method: "POST" });
    expect(status).toBe(200);
    expect(body).toMatchObject({
      gh: { state: "ready" },
      claude: { state: "ready" },
      helpers: { "playwright-cli": { installed: true, path: "/opt/homebrew/bin/playwright-cli", version: "0.1.1" } },
    });
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

  it("serves the logo files from the web package with their image types", async () => {
    const h = await home();
    const ui = join(h, "public");
    await cp(fileURLToPath(new URL("../../web/public", import.meta.url)), ui, { recursive: true });
    await writeFile(join(ui, "index.html"), "<!doctype html><title>donePM</title>");
    const d = await start(h, undefined, ui);
    const types: Record<string, RegExp> = {
      "/favicon.svg": /image\/svg\+xml/,
      "/favicon.ico": /image\/(x-icon|vnd\.microsoft\.icon)/,
      "/apple-touch-icon.png": /image\/png/,
      "/icons/icon-512x512.png": /image\/png/,
    };
    for (const [path, type] of Object.entries(types)) {
      const res = await fetch(d.address() + path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type"), path).toMatch(type);
    }
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

  it("after a restart a running item waits with Resume, which continues the session with --resume", async () => {
    const h = await homeWithHistory();
    const first = fakeProcesses();
    let d = await start(h, undefined, undefined, first);
    const item = (await get(d, "/api/items")).body.find((i: any) => i.externalId === "acme/widgets#161");
    await get(d, `/api/items/${item.id}/start`, { method: "POST" });
    await waitFor(() => expect(first.spawned).toHaveLength(1));
    first.last().emit(
      { type: "system", subtype: "init", session_id: "s1" },
      { type: "control_request", request_id: "r1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls" } } },
    );
    await get(d, `/api/asks/${(await get(d, `/api/items/${item.id}`)).body.asks[0].id}/answer`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ behavior: "allow" }),
    });
    first.last().emit({ type: "control_request", request_id: "r2", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "rm x" } } });
    expect((await get(d, `/api/items/${item.id}`)).body.state).toBe("needs_you");
    // An agent mid-turn: shutdown denies the open ask and keeps the state.
    await daemon!.stop();
    expect(first.last().signals).toEqual(["SIGTERM"]);

    const second = fakeProcesses();
    daemon = undefined;
    d = await start(h, undefined, undefined, second);
    const after = (await get(d, `/api/items/${item.id}`)).body;
    expect(after.state).toBe("needs_you");
    expect(after.attention).toEqual({ kind: "resume", reason: "donePM is shutting down" });
    expect(after.asks.map((a: any) => a.state)).toEqual(["allowed", "denied"]);
    expect(second.spawned).toHaveLength(0);

    const resumed = await get(d, `/api/items/${item.id}/resume`, { method: "POST" });
    expect(resumed.status).toBe(202);
    expect(resumed.body.state).toBe("running");
    await waitFor(() => expect(second.spawned).toHaveLength(1));
    const proc = second.last();
    expect(proc.args).toEqual(expect.arrayContaining(["--resume", "s1"]));
    expect(proc.opts.cwd).toBe(after.worktreePath);
    expect(proc.sent()[0].message.content[0].text).toBe("Continue where you left off.");
    expect((await get(d, `/api/items/${item.id}/resume`, { method: "POST" })).status).toBe(409);
    expect((await get(d, `/api/items/${item.id}`)).body.events.map((e: any) => e.type).slice(-1)).toEqual(["agent.resumed"]);
  });

  it("interrupts running items on start: no session fails, a missing worktree fails with the reason", async () => {
    const h = await homeWithHistory();
    const spawn = fakeProcesses();
    let d = await start(h, undefined, undefined, spawn);
    const items = (await get(d, "/api/items")).body.filter((i: any) => i.repo);
    const [a, b] = items;
    await get(d, "/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxConcurrentAgents: 2 }) });
    for (const i of [a, b]) {
      await get(d, `/api/items/${i.id}/start`, { method: "POST" });
      await waitFor(() => expect(spawn.spawned.length).toBeGreaterThan(i === a ? 0 : 1));
    }
    // a never reported a session; b did, but its worktree disappears while donePM is down.
    spawn.spawned[1]!.emit({ type: "system", subtype: "init", session_id: "s2" });
    const bPath = (await get(d, `/api/items/${b.id}`)).body.worktreePath;
    await daemon!.stop();
    execFileSync("rm", ["-rf", bPath]);

    daemon = undefined;
    d = await start(h, undefined, undefined, fakeProcesses());
    const aNow = (await get(d, `/api/items/${a.id}`)).body;
    expect(aNow.state).toBe("failed");
    expect(aNow.attention.reason).toBe("donePM restarted before the agent started");
    const bNow = (await get(d, `/api/items/${b.id}`)).body;
    expect(bNow.state).toBe("failed");
    expect(bNow.attention.reason).toBe(`worktree ${bPath} is missing`);
    expect(bNow.worktreePath).toBeUndefined();
    expect(bNow.agentSessionId).toBeUndefined();
    expect((await get(d, `/api/items/${b.id}/resume`, { method: "POST" })).status).toBe(409);
  });

  it("removes a failed item's worktree and lists and removes orphaned ones", async () => {
    const h = await homeWithHistory();
    const spawn = fakeProcesses();
    const d = await start(h, undefined, undefined, spawn);
    const item = (await get(d, "/api/items")).body.find((i: any) => i.externalId === "acme/widgets#161");
    await get(d, `/api/items/${item.id}/start`, { method: "POST" });
    await waitFor(() => expect(spawn.spawned).toHaveLength(1));
    const { worktreePath, branch } = (await get(d, `/api/items/${item.id}`)).body;
    expect((await get(d, `/api/items/${item.id}/worktree/remove`, { method: "POST" })).status).toBe(409);
    await get(d, `/api/items/${item.id}/stop`, { method: "POST" });

    const clone = join(h, "Code", "acme", "widgets");
    const orphan = join(h, ".local/share/donepm/worktrees/acme-widgets/leftover");
    git(clone, "worktree", "add", "-q", "-b", "leftover", orphan);
    // Worktrees outside donePM's root are the user's.
    git(clone, "worktree", "add", "-q", "-b", "mine", join(h, "elsewhere"));
    const listed = (await get(d, "/api/worktrees/orphaned")).body;
    expect(listed.map((o: any) => [o.path.endsWith("/leftover"), o.branch])).toEqual([[true, "leftover"]]);
    expect(listed[0].lastCommitAt).toEqual(expect.any(String));

    const removed = await get(d, `/api/items/${item.id}/worktree/remove`, { method: "POST" });
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ state: "failed" });
    expect(removed.body.worktreePath).toBeUndefined();
    expect(existsSync(worktreePath)).toBe(false);
    expect(git(clone, "branch", "--list", branch).trim()).not.toBe("");
    expect(git(clone, "worktree", "list")).not.toContain(worktreePath);

    const post = (path: string) =>
      get(d, "/api/worktrees/orphaned/remove", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) });
    expect((await post(join(h, "elsewhere"))).status).toBe(404);
    expect((await post(listed[0].path)).body).toEqual({ ok: true });
    expect(existsSync(orphan)).toBe(false);
    expect((await get(d, "/api/worktrees/orphaned")).body).toEqual([]);
    expect(existsSync(join(h, "elsewhere"))).toBe(true);
  });

  describe("a new worktree root (#93)", () => {
    const put = (d: Daemon, body: object, query = "") =>
      get(d, `/api/settings${query}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

    /** #161 has a worktree and a session but no agent; the second item's agent is still running. */
    async function twoItems() {
      // Resolved (`/var` → `/private/var`), so the paths git lists compare with ours.
      const h = realpathSync(await homeWithHistory());
      const spawn = fakeProcesses();
      const d = await start(h, undefined, undefined, spawn);
      await put(d, { maxConcurrentAgents: 2 });
      const all = (await get(d, "/api/items")).body.filter((i: any) => i.repo);
      const idle = all.find((i: any) => i.externalId === "acme/widgets#161");
      const busy = all.find((i: any) => i !== idle);
      await get(d, `/api/items/${idle.id}/start`, { method: "POST" });
      await waitFor(() => expect(spawn.spawned).toHaveLength(1));
      spawn.last().emit({ type: "system", subtype: "init", session_id: "s1" });
      await get(d, `/api/items/${idle.id}/stop`, { method: "POST" });
      await get(d, `/api/items/${busy.id}/start`, { method: "POST" });
      await waitFor(() => expect(spawn.spawned).toHaveLength(2));
      const path = (id: string) => get(d, `/api/items/${id}`).then((r) => r.body.worktreePath as string);
      return { h, d, spawn, idle, busy, idlePath: await path(idle.id), busyPath: await path(busy.id), clone: join(h, "Code", "acme", "widgets") };
    }

    it("asks first, then moves with git worktree move, skips running agents, and the session resumes there", async () => {
      const { h, d, spawn, idle, busy, idlePath, busyPath, clone } = await twoItems();
      const newRoot = join(h, "new-root");

      const asked = await put(d, { worktreeRoot: newRoot });
      expect(asked.status).toBe(409);
      expect(asked.body.worktreesAtOldRoot).toEqual(expect.arrayContaining([
        { itemId: idle.id, title: idle.title, path: idlePath, running: false },
        { itemId: busy.id, title: busy.title, path: busyPath, running: true },
      ]));
      expect((await get(d, "/api/settings")).body.worktreeRoot).toBe("~/.local/share/donepm/worktrees");
      expect((await put(d, { worktreeRoot: newRoot }, "?worktrees=sideways")).status).toBe(400);

      const moved = await put(d, { worktreeRoot: newRoot }, "?worktrees=move");
      expect(moved.status).toBe(200);
      expect(moved.body.settings).toMatchObject({ worktreeRoot: newRoot, previousWorktreeRoots: ["~/.local/share/donepm/worktrees"] });
      const target = join(newRoot, "acme-widgets", idlePath.split("/").at(-1)!);
      expect(moved.body.worktrees).toEqual({
        moved: [{ itemId: idle.id, title: idle.title, from: idlePath, to: target }],
        skipped: [{ itemId: busy.id, title: busy.title, path: busyPath, reason: "its agent is running" }],
      });
      expect(existsSync(target)).toBe(true);
      expect(existsSync(idlePath)).toBe(false);
      expect(existsSync(busyPath)).toBe(true);
      const listed = git(clone, "worktree", "list", "--porcelain");
      expect(listed).toContain(`worktree ${target}\n`);
      expect(listed).not.toContain(`worktree ${idlePath}\n`);
      const after = (await get(d, `/api/items/${idle.id}`)).body;
      expect(after).toMatchObject({ worktreePath: target, agentSessionId: "s1" });
      expect(after.events.at(-1)).toMatchObject({ type: "worktree.moved", actor: "user", payload: { from: idlePath, to: target } });

      // Former root still holds the running item's worktree, so its orphans are still found.
      const orphan = join(h, ".local/share/donepm/worktrees/acme-widgets/leftover");
      git(clone, "worktree", "add", "-q", "-b", "leftover", orphan);
      expect((await get(d, "/api/worktrees/orphaned")).body.map((o: any) => o.branch)).toEqual(["leftover"]);

      await get(d, `/api/items/${idle.id}/start`, { method: "POST" });
      await waitFor(() => expect(spawn.spawned).toHaveLength(3));
      expect(spawn.last().args).toEqual(expect.arrayContaining(["--resume", "s1"]));
      expect(spawn.last().opts.cwd).toBe(target);
    });

    it("leaves them where they are: paths, git and resume unchanged, new worktrees under the new root", async () => {
      const { h, d, spawn, idle, busy, idlePath, clone } = await twoItems();
      const newRoot = join(h, "new-root");
      const left = await put(d, { worktreeRoot: newRoot }, "?worktrees=leave");
      expect(left.status).toBe(200);
      expect(left.body.worktrees).toBeUndefined();
      expect(left.body.settings.previousWorktreeRoots).toEqual(["~/.local/share/donepm/worktrees"]);
      expect((await get(d, `/api/items/${idle.id}`)).body.worktreePath).toBe(idlePath);
      expect(git(clone, "worktree", "list", "--porcelain")).toContain(`worktree ${idlePath}\n`);
      // Changing something else asks nothing.
      expect((await put(d, { branchPrefix: "dp/" })).status).toBe(200);

      await get(d, `/api/items/${idle.id}/start`, { method: "POST" });
      await waitFor(() => expect(spawn.spawned).toHaveLength(3));
      expect(spawn.last().opts.cwd).toBe(idlePath);

      // A fresh worktree goes to the new root.
      await get(d, `/api/items/${busy.id}/stop`, { method: "POST" });
      expect((await get(d, `/api/items/${busy.id}/worktree/remove`, { method: "POST" })).status).toBe(200);
      await get(d, `/api/items/${busy.id}/start`, { method: "POST" });
      await waitFor(() => expect(spawn.spawned).toHaveLength(4));
      expect(spawn.last().opts.cwd.startsWith(join(newRoot, "acme-widgets"))).toBe(true);

      // Back to the old root: it is no former root any more.
      const back = await put(d, { worktreeRoot: "~/.local/share/donepm/worktrees" }, "?worktrees=leave");
      expect(back.body.settings.previousWorktreeRoots).toEqual([newRoot]);
    });
  });

  it("starts an agent: worktree, setup, claude in the worktree, transcript stored", async () => {
    const h = await homeWithHistory();
    const spawn = fakeProcesses();
    const d = await start(h, undefined, undefined, spawn);
    expect(await readFile(join(h, ".config/donepm/playbooks/implement.md"), "utf8")).toMatch(/name: implement/);
    // The built-in review playbook (D42) parses: read-only, review drafts only, for review requests.
    expect(parsePlaybook(await readFile(join(h, ".config/donepm/playbooks/review.md"), "utf8"))).toMatchObject({
      name: "review", readOnly: true, drafts: ["review"], permissionMode: "default", match: { source: "github-pr" },
    });
    const item = (await get(d, "/api/items")).body.find((i: any) => i.externalId === "acme/widgets#161");

    const started = await get(d, `/api/items/${item.id}/start`, { method: "POST" });
    expect(started.status).toBe(202);
    expect(started.body.state).toBe("running");
    await waitFor(() => expect(spawn.spawned).toHaveLength(1));

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

  it("collects a repository's own query, tests it over HTTP and assigns on start when opted in", async () => {
    const h = await homeWithHistory();
    await mkdir(join(h, ".config/donepm"), { recursive: true });
    await writeFile(join(h, ".config/donepm/config.json"), JSON.stringify({
      sources: { ...FIXTURE_SOURCES, "github.com/acme/widgets": { query: "is:issue no:assignee", assignOnStart: true, managed: true } },
    }));
    const spawn = fakeProcesses();
    const d = await start(h, undefined, undefined, spawn);
    const items = (await get(d, "/api/items")).body;
    expect(items.map((i: any) => i.externalId)).toContain("acme/widgets#200");
    expect((await get(d, "/api/status")).body.lastPoll).toMatchObject({
      ok: true, issues: 5, sources: { "github.com/acme/widgets": { ok: true, issues: 1 } },
    });

    const json = { "content-type": "application/json" };
    const tested = await get(d, "/api/sources/test", {
      method: "POST", headers: json, body: JSON.stringify({ origin: "github.com/acme/widgets", query: "label:bug" }),
    });
    expect(tested.body).toEqual({
      count: 1, issues: [{ number: 200, title: "Unassigned bug", url: "https://github.com/acme/widgets/issues/200" }],
    });
    const foreign = await get(d, "/api/sources/test", {
      method: "POST", headers: json, body: JSON.stringify({ origin: "gitlab.com/a/b", query: "x" }),
    });
    expect(foreign.status).toBe(400);

    const item = items.find((i: any) => i.externalId === "acme/widgets#161");
    await get(d, `/api/items/${item.id}/start`, { method: "POST" });
    await waitFor(async () =>
      expect((await get(d, `/api/items/${item.id}`)).body.events.map((e: any) => e.type)).toContain("item.assigned"),
    );

    const put = await get(d, "/api/settings", { method: "PUT", headers: json, body: JSON.stringify({ sources: {} }) });
    expect(put.body.settings.sources).toEqual({});
    expect(JSON.parse(await readFile(join(h, ".config/donepm/config.json"), "utf8")).sources).toEqual({});
  });

  it("shows agent info on the item and stops the agent over HTTP", async () => {
    const spawn = fakeProcesses();
    const d = await start(await homeWithHistory(), undefined, undefined, spawn);
    const item = (await get(d, "/api/items")).body.find((i: any) => i.externalId === "acme/widgets#161");
    expect(item.agent).toEqual({ running: false });
    expect((await get(d, `/api/items/${item.id}/stop`, { method: "POST" })).status).toBe(409);

    await get(d, `/api/items/${item.id}/start`, { method: "POST" });
    await waitFor(() => expect(spawn.spawned).toHaveLength(1));
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

  it("closes never-started items closed upstream and lets the user dismiss a started one", async () => {
    let search = fixture("gh/search-issues.json");
    let view = fixture("gh/issue-view-open.json");
    const spawn = fakeProcesses();
    const d = await start(await homeWithHistory(), () => search, undefined, spawn, () => view);
    const item = (await get(d, "/api/items")).body.find((i: any) => i.externalId === "acme/widgets#161");
    await get(d, `/api/items/${item.id}/start`, { method: "POST" });
    await waitFor(() => expect(spawn.spawned).toHaveLength(1));
    expect((await get(d, `/api/items/${item.id}/dismiss`, { method: "POST" })).body).toEqual({ error: "the issue is not closed upstream" });

    search = fixture("gh/search-issues-empty.json");
    view = fixture("gh/issue-view-closed.json");
    await d.pollNow();
    const items = (await get(d, "/api/items")).body;
    expect(items.filter((i: any) => i.id !== item.id).map((i: any) => i.state)).toEqual(["done", "done", "done"]);
    const other = items.find((i: any) => i.id !== item.id);
    expect((await get(d, `/api/items/${other.id}`)).body.events.map((e: any) => e.type)).toEqual(["item.collected", "item.closed_upstream"]);
    expect(items.find((i: any) => i.id === item.id)).toMatchObject({ state: "running", badges: expect.arrayContaining(["closed-upstream"]) });

    expect((await get(d, `/api/items/${item.id}/dismiss`, { method: "POST" })).body).toEqual({ error: "stop the agent first" });
    await get(d, `/api/items/${item.id}/stop`, { method: "POST" });
    const dismissed = await get(d, `/api/items/${item.id}/dismiss`, { method: "POST" });
    expect(dismissed.status).toBe(200);
    expect(dismissed.body).toMatchObject({ state: "done" });
    expect(dismissed.body.worktreePath).toBeDefined();
    expect(existsSync(dismissed.body.worktreePath)).toBe(true);
    expect((await get(d, `/api/items/${item.id}/dismiss`, { method: "POST" })).status).toBe(409);
    expect((await get(d, "/api/items/nope/dismiss", { method: "POST" })).status).toBe(404);
  });

  it("changes the playbook of a Ready item until it starts, and passes the composer's note to the running agent", async () => {
    const spawn = fakeProcesses();
    const d = await start(await homeWithHistory(), undefined, undefined, spawn);
    const item = (await get(d, "/api/items")).body.find((i: any) => i.externalId === "acme/widgets#161");
    const put = (body: unknown) =>
      get(d, `/api/items/${item.id}/playbook`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const say = (body: unknown) =>
      get(d, `/api/items/${item.id}/say`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

    expect(item.playbook).toBe("implement");
    const changed = await put({ playbook: "review" });
    expect(changed).toMatchObject({ status: 200, body: { playbook: "review", state: "ready" } });
    expect((await get(d, `/api/items/${item.id}`)).body.events.at(-1)).toMatchObject({
      type: "item.playbook_changed", actor: "user", payload: { from: "implement", to: "review" },
    });
    expect((await put({ playbook: "nope" })).status).toBe(400);
    expect((await put({})).status).toBe(400);
    expect((await get(d, "/api/items/nope/playbook", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ playbook: "review" }) })).status).toBe(404);
    expect((await put({ playbook: "implement" })).status).toBe(200);

    expect((await say({ text: "hi" })).body).toEqual({ error: "the agent is not running" });
    await get(d, `/api/items/${item.id}/start`, { method: "POST" });
    await waitFor(() => expect(spawn.spawned).toHaveLength(1));
    const proc = spawn.last();
    proc.emit({ type: "system", subtype: "init", session_id: "s1" });
    expect((await put({ playbook: "review" })).status).toBe(409);
    expect((await say({ text: "  " })).status).toBe(400);
    expect(await say({ text: "Keep the old tag as an alias." })).toEqual({ status: 200, body: { ok: true } });
    expect(proc.sent().at(-1)).toMatchObject({ type: "user", message: { role: "user", content: [{ type: "text", text: "Keep the old tag as an alias." }] } });
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
    await waitFor(async () => expect((await get(d, `/api/items/${item.id}`)).body.state).toBe("failed"));
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
    await waitFor(() => expect(spawn.spawned).toHaveLength(1));
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

  it("always allows per repository over HTTP, lists the grant and removes it", async () => {
    const spawn = fakeProcesses();
    const d = await start(await homeWithHistory(), undefined, undefined, spawn);
    const item = (await get(d, "/api/items")).body.find((i: any) => i.externalId === "acme/widgets#161");
    await get(d, `/api/items/${item.id}/start`, { method: "POST" });
    await waitFor(() => expect(spawn.spawned).toHaveLength(1));
    const ask = (id: string) => ({
      type: "control_request", request_id: id,
      request: {
        subtype: "can_use_tool", tool_name: "Bash", input: { command: "pnpm test" },
        permission_suggestions: [{ type: "addRules", behavior: "allow", destination: "localSettings", rules: [{ toolName: "Bash", ruleContent: "pnpm test *" }] }],
      },
    });
    spawn.last().emit(ask("r1"));
    const [first] = (await get(d, `/api/items/${item.id}`)).body.asks;
    const json = { method: "POST", headers: { "content-type": "application/json" } };
    expect((await get(d, `/api/asks/${first.id}/answer`, { ...json, body: JSON.stringify({ behavior: "allow", scope: "always" }) })).body).toEqual({ ok: true });

    const grants = (await get(d, "/api/grants")).body;
    expect(grants).toMatchObject([{ repo: "github.com/acme/widgets", toolName: "Bash", ruleContent: "pnpm test *", call: "Bash: pnpm test", useCount: 0 }]);
    spawn.last().emit(ask("r2"));
    expect(spawn.last().sent().at(-1).response).toMatchObject({ request_id: "r2", response: { behavior: "allow" } });
    expect((await get(d, "/api/grants")).body[0].useCount).toBe(1);

    expect((await get(d, `/api/grants/${grants[0].id}/revoke`, { method: "POST" })).body.revokedAt).toEqual(expect.any(String));
    expect((await get(d, `/api/grants/${grants[0].id}/revoke`, { method: "POST" })).status).toBe(404);
    expect((await get(d, "/api/grants")).body).toEqual([]);
    spawn.last().emit(ask("r3"));
    const detail = (await get(d, `/api/items/${item.id}`)).body;
    expect(detail.state).toBe("needs_you");
    expect(detail.events.map((e: any) => e.type)).toContain("permission.grant_revoked");
  });

  it("approving a draft commits leftovers, opens the PR and waits for CI", async () => {
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
    expect(after).toMatchObject({ state: "checking", pr: { number: 200 } });
    expect(after.attention).toBeUndefined();
    expect(after.events.map((e: any) => e.type).slice(-3)).toEqual(["draft.approved", "draft.executed", "ci.started"]);
    // The agent's work is published; its process is ended while CI runs.
    expect(proc.signals).toEqual(["SIGTERM"]);
    expect((await get(d, `/api/drafts/${detail.drafts[0].id}/approve`, { method: "POST" })).status).toBe(409);

    // The next poll reads the PR's checks: red, so the user decides.
    await d.pollNow();
    const red = (await get(d, `/api/items/${item.id}`)).body;
    expect(red).toMatchObject({ state: "needs_you", attention: { kind: "ci_failed", pr: { number: 200 }, runs: ["37149187747"] } });
    expect(red.attention.failed).toHaveLength(2);
    expect(red.attention.logs).toHaveLength(2);
    expect((await get(d, `/api/items/${item.id}/ci/done`, { method: "POST" })).body).toMatchObject({ state: "done" });
    expect((await get(d, `/api/items/${item.id}/ci/rerun`, { method: "POST" })).status).toBe(409);
    stdin.end();
    await shim;
  });

  it("rejecting a pending draft after a restart resumes the session with the reason", async () => {
    const h = await homeWithHistory();
    const first = fakeProcesses();
    let d = await start(h, undefined, undefined, first);
    const { item, stdin, shim } = await agentDrafts(d, first);
    stdin.end();
    await shim;
    const draftId = (await get(d, `/api/items/${item.id}`)).body.drafts[0].id;
    await daemon!.stop();

    const second = fakeProcesses();
    daemon = undefined;
    d = await start(h, undefined, undefined, second);
    expect((await get(d, `/api/items/${item.id}`)).body.state).toBe("needs_you");
    const res = await get(d, `/api/drafts/${draftId}/reject`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "Add a test" }),
    });
    expect(res).toMatchObject({ status: 200, body: { state: "rejected" } });
    await waitFor(() => expect(second.spawned).toHaveLength(1));
    const proc = second.last();
    expect(proc.args).toEqual(expect.arrayContaining(["--resume", "s1"]));
    expect(proc.sent()[0].message.content[0].text).toContain("Add a test");
    const after = (await get(d, `/api/items/${item.id}`)).body;
    expect(after.state).toBe("running");
    expect(after.drafts[0].state).toBe("rejected");
    expect(after.events.map((e: any) => e.type).slice(-1)).toEqual(["draft.rejected"]);
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
    expect(detail.attention).toEqual({ kind: "draft", draftId, draftType: "pr", title: "Fix search" });
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

  it("shows a finished item muted, then moves it to the archive on the next poll after archiveAfterHours (D37)", async () => {
    const d = await start(await home());
    const json = { "content-type": "application/json" };
    const externalId = "solo/tool#61";
    const { id } = d.db.prepare("SELECT id FROM items WHERE external_id = ?").get(externalId) as { id: string };
    d.db.prepare("UPDATE items SET state = 'done', state_since = ? WHERE id = ?").run("2026-01-01T00:00:00.000Z", id);
    expect((await get(d, `/api/items/${id}`)).body).toMatchObject({ state: "done", finishedAt: "2026-01-01T00:00:00.000Z" });
    expect((await get(d, "/api/archive")).body).toEqual([]);

    const saved = await get(d, "/api/settings", { method: "PUT", headers: json, body: JSON.stringify({ archiveAfterHours: 0, deleteAfterDays: null }) });
    expect(saved.status).toBe(200);
    await d.pollNow();
    expect((await get(d, "/api/items")).body.map((i: any) => i.externalId)).not.toContain(externalId);
    const archive = (await get(d, "/api/archive")).body;
    expect(archive.map((i: any) => [i.id, i.state])).toEqual([[id, "done"]]);
    expect(archive[0].archivedAt).toBeDefined();
    expect((await get(d, `/api/items/${id}`)).status).toBe(200);
    expect((await get(d, "/api/settings", { method: "PUT", headers: json, body: JSON.stringify({ archiveAfterHours: -1 }) })).status).toBe(400);
  });

  describe("managed repositories (D46)", () => {
    const WIDGETS = "github.com/acme/widgets";
    const json = { "content-type": "application/json" };
    const put = (d: Daemon, path: string, body: unknown) => get(d, path, { method: "PUT", headers: json, body: JSON.stringify(body) });
    const manage = async (d: Daemon, managed: boolean) => {
      const repo = (await get(d, "/api/repos")).body.find((r: any) => r.originUrl === WIDGETS);
      return put(d, `/api/repos/${repo.id}`, { managed });
    };
    const externalIds = async (d: Daemon) => (await get(d, "/api/items")).body.map((i: any) => i.externalId);
    const configFile = (h: string) => join(h, ".config/donepm/config.json");
    const fresh = async (h: string) => {
      daemon = await createDaemon({
        home: h, exec: execWith(() => fixture("gh/search-issues.json")), ctx: testCtx(), version: "0.0.0-test", port: 0,
        publicDir: join(h, "no-ui"), spawn: fakeProcesses(), env: { PATH: "/usr/bin:/bin" },
      });
      await daemon.start();
      await daemon.pollNow();
      return daemon;
    };

    it("starts a fresh install with nothing managed and offers what the search found", async () => {
      const h = await home();
      const d = await fresh(h);
      const config = JSON.parse(await readFile(configFile(h), "utf8"));
      expect(config).toMatchObject({ port: 6174, sources: {} });
      expect(await externalIds(d)).toEqual([]);
      expect((await get(d, "/api/repos")).body.map((r: any) => [r.originUrl, r.managed])).toEqual([[WIDGETS, false]]);
      expect((await get(d, "/api/status")).body.lastPoll).toMatchObject({
        ok: true, issues: 0, discovered: { "github.com/acme/api": 1, "github.com/solo/tool": 1 },
      });

      // "Clone and manage": the clone starts and the repository's work is collected.
      const res = await get(d, "/api/repos/clone", { method: "POST", headers: json, body: JSON.stringify({ origin: "github.com/solo/tool" }) });
      expect(res.status).toBe(202);
      expect(JSON.parse(await readFile(configFile(h), "utf8")).sources).toEqual({ "github.com/solo/tool": { assignOnStart: false, managed: true } });
      await waitFor(async () => expect(await externalIds(d)).toEqual(["solo/tool#61"]));

      expect((await manage(d, true)).status).toBe(200);
      await waitFor(async () => expect((await externalIds(d)).sort()).toEqual(["acme/widgets#157", "acme/widgets#161", "solo/tool#61"]));
      expect((await get(d, "/api/status")).body.lastPoll.discovered).toEqual({ "github.com/acme/api": 1 });
    });

    it("migrates once: origins with items or settings are managed, ignored ones are not", async () => {
      const h = await home();
      await start(h);
      await daemon!.stop();
      daemon = undefined;
      await writeFile(configFile(h), JSON.stringify({ sources: { "github.com/acme/api": { assignOnStart: false, ignored: true } } }));

      const d = await start(h, () => fixture("gh/search-issues-empty.json"));
      expect(JSON.parse(await readFile(configFile(h), "utf8")).sources).toEqual({
        [WIDGETS]: { assignOnStart: false, managed: true },
        "github.com/solo/tool": { assignOnStart: false, managed: true },
        "github.com/acme/api": { assignOnStart: false, managed: false },
      });
      expect(await externalIds(d)).toEqual(["acme/widgets#161", "acme/widgets#157", "solo/tool#61"]);

      // Unmanaging everything is a choice the next start keeps.
      for (const origin of [WIDGETS, "github.com/solo/tool"]) {
        const { sources } = (await get(d, "/api/settings")).body;
        await put(d, "/api/settings", { sources: { ...sources, [origin]: { assignOnStart: false, managed: false } } });
      }
      await daemon!.stop();
      daemon = undefined;
      const again = await start(h, () => fixture("gh/search-issues-empty.json"));
      expect(await externalIds(again)).toEqual([]);
    });

    it("hides the idle items of an unmanaged repository, stops polling it and brings the same items back", async () => {
      const h = await home();
      const d = await start(h);
      const before = (await get(d, "/api/items")).body.map((i: any) => [i.externalId, i.id]);
      expect((await get(d, "/api/repos")).body.map((r: any) => [r.originUrl, r.managed])).toEqual([[WIDGETS, true]]);

      const hidden = await manage(d, false);
      expect(hidden.status).toBe(200);
      expect(hidden.body.repos.map((r: any) => [r.originUrl, r.managed])).toEqual([[WIDGETS, false]]);
      expect(hidden.body.settings.sources[WIDGETS]).toEqual({ assignOnStart: false, managed: false });
      expect(JSON.parse(await readFile(configFile(h), "utf8")).sources).toEqual(hidden.body.settings.sources);
      expect(await externalIds(d)).toEqual(["solo/tool#61", "Acme/API#12"]);

      // Nothing is deleted: the item is still there by id, and the next poll leaves it alone.
      const [hiddenId] = before[0]!.slice(1);
      expect((await get(d, `/api/items/${hiddenId}`)).status).toBe(200);
      await d.pollNow();
      expect(await externalIds(d)).toEqual(["solo/tool#61", "Acme/API#12"]);
      expect((await get(d, "/api/status")).body.lastPoll).toMatchObject({ ok: true, issues: 2 });
      expect(d.db.prepare("SELECT COUNT(*) AS n FROM items").get()).toEqual({ n: 4 });

      const shown = await manage(d, true);
      expect(shown.body.settings.sources[WIDGETS]).toEqual({ assignOnStart: false, managed: true });
      await d.pollNow();
      expect((await get(d, "/api/items")).body.map((i: any) => [i.externalId, i.id])).toEqual(before);
      expect((await get(d, "/api/status")).body.lastPoll).toMatchObject({ ok: true, issues: 4 });
    });

    it("keeps an unmanaged repository's running items and items with a pending draft on the board", async () => {
      const d = await start(await home());
      const [pendingDraft, running] = ["acme/widgets#161", "acme/widgets#157"];
      const at = "2026-10-03T12:00:00.000Z";
      const id = (externalId: string) => (d.db.prepare("SELECT id FROM items WHERE external_id = ?").get(externalId) as { id: string }).id;
      d.db
        .prepare("INSERT INTO drafts (id, item_id, type, payload, state, created_at, updated_at) VALUES (?, ?, 'pr', ?, 'pending', ?, ?)")
        .run("d1", id(pendingDraft!), JSON.stringify({ title: "Fix", body: "", base: "main" }), at, at);
      d.db.prepare("UPDATE items SET state = 'running' WHERE id = ?").run(id(running!));

      await manage(d, false);
      expect(await externalIds(d)).toEqual(["acme/widgets#161", "acme/widgets#157", "solo/tool#61", "Acme/API#12"]);

      // Once the draft is settled and the agent is done, nothing needs the user and the items go.
      d.db.prepare("UPDATE drafts SET state = 'rejected' WHERE id = 'd1'").run();
      d.db.prepare("UPDATE items SET state = 'done' WHERE id = ?").run(id(running!));
      expect(await externalIds(d)).toEqual(["solo/tool#61", "Acme/API#12"]);
    });

    it("pushes item.removed for hidden items and item.updated for the ones that return", async () => {
      const d = await start(await home());
      const ws = new WebSocket(d.address().replace("http", "ws") + "/ws");
      await new Promise((r) => ws.once("open", r));
      const messages: any[] = [];
      ws.on("message", (m) => messages.push(JSON.parse(String(m))));
      const of = (type: string) => messages.filter((m) => m.type === type).map((m) => m.payload.externalId ?? m.payload.id);
      const ids = Object.fromEntries((await get(d, "/api/items")).body.map((i: any) => [i.externalId, i.id]));

      await manage(d, false);
      await waitFor(() => expect(of("item.removed")).toEqual([ids["acme/widgets#161"], ids["acme/widgets#157"]]));
      expect(of("item.updated")).toEqual([]);

      await manage(d, true);
      await waitFor(() => expect(of("item.updated").slice(0, 2)).toEqual(["acme/widgets#161", "acme/widgets#157"]));
      await d.pollNow();
      ws.close();
    });

    it("changes one origin at a time and needs no restart, also through the settings patch", async () => {
      const d = await start(await home());
      const other = { query: "label:bug", assignOnStart: true, managed: true };
      const saved = await put(d, "/api/settings", { sources: { ...FIXTURE_SOURCES, "github.com/solo/tool": other } });
      expect(saved.body).toMatchObject({ settings: { sources: { "github.com/solo/tool": other } }, restartRequired: false });

      expect((await manage(d, false)).body.settings.sources).toMatchObject({
        "github.com/solo/tool": other,
        [WIDGETS]: { assignOnStart: false, managed: false },
      });
      expect((await manage(d, true)).body.settings.sources[WIDGETS]).toEqual({ assignOnStart: false, managed: true });

      const patched = await put(d, "/api/settings", { sources: { ...FIXTURE_SOURCES, [WIDGETS]: { managed: false } } });
      expect(patched.body.restartRequired).toBe(false);
      expect(await externalIds(d)).toEqual(["solo/tool#61", "Acme/API#12"]);
      expect((await put(d, "/api/settings", { sources: FIXTURE_SOURCES })).body.restartRequired).toBe(false);
      await d.pollNow();
      expect(await externalIds(d)).toEqual(expect.arrayContaining(["acme/widgets#161", "acme/widgets#157"]));
    });

    it("refuses to start an item of an unmanaged repository", async () => {
      const d = await start(await home());
      const item = (await get(d, "/api/items")).body.find((i: any) => i.externalId === "acme/widgets#161");
      await manage(d, false);
      expect(await get(d, `/api/items/${item.id}/start`, { method: "POST" })).toEqual({
        status: 409, body: { error: `${WIDGETS} is not managed` },
      });
      expect((await get(d, `/api/items/${item.id}`)).body.state).toBe("ready");
    });

    it("rejects a bad body and an unknown repository", async () => {
      const d = await start(await home());
      const repo = (await get(d, "/api/repos")).body[0];
      expect((await put(d, `/api/repos/${repo.id}`, { managed: "yes" })).status).toBe(400);
      expect((await put(d, `/api/repos/${repo.id}`, { managed: true, query: "x" })).status).toBe(400);
      expect((await put(d, "/api/repos/nope", { managed: true })).status).toBe(404);
    });
  });
});
