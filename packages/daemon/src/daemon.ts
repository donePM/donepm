import type { Ctx, WorkItem } from "@donepm/core";
import type { FastifyInstance } from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { agentEnv } from "./agent/env.js";
import { spawnProcess, type ProcessFactory } from "./agent/process.js";
import { AgentRunner } from "./agent/runner.js";
import { recoverAfterRestart } from "./agent/restart.js";
import { resumeItem, startItem, type StartDeps } from "./agent/start.js";
import { AskStore } from "./asks/store.js";
import { writeMcpConfig } from "./bridge/mcp-config.js";
import { listenBridge } from "./bridge/server.js";
import { BridgeSessions } from "./bridge/sessions.js";
import { detectClaude } from "./claude/detect.js";
import { loadConfig, saveConfig, type Config } from "./config/config.js";
import { expandHome, pathsFor } from "./config/paths.js";
import { openDb, type Db } from "./db/database.js";
import { editDraft, rejectDraft } from "./drafts/actions.js";
import { approveDraft, failInterrupted } from "./drafts/execute.js";
import { DraftStore } from "./drafts/store.js";
import { itemDiff } from "./diff/item-diff.js";
import { EventStore } from "./events/store.js";
import { collectIssues } from "./gh/collect-issues.js";
import { detectGh } from "./gh/detect.js";
import { fetchQueryIssues } from "./gh/issues.js";
import { Poller } from "./gh/poller.js";
import { buildServer } from "./http/server.js";
import { makeGuard } from "./http/guard.js";
import { itemWriter } from "./items/commit.js";
import { ItemStore } from "./items/store.js";
import { relinkItems } from "./items/sync.js";
import { agentHistory } from "./items/agent-info.js";
import { attentionOf } from "./items/attention.js";
import { toItemView, type CurrentTool } from "./items/view.js";
import type { Exec } from "./process/exec.js";
import { ensureDefaultPlaybook } from "./playbooks/load.js";
import { discoverRepos } from "./repos/discover.js";
import { RepoStore } from "./repos/store.js";
import { StatusStore } from "./status/status.js";
import { TranscriptStore } from "./transcript/store.js";
import { failMissingWorktrees, findOrphans } from "./worktrees/reconcile.js";
import { removeItemWorktree, removeOrphan } from "./worktrees/remove.js";
import { Hub } from "./ws/hub.js";

export interface DaemonOptions {
  home: string;
  exec: Exec;
  ctx: Ctx;
  version: string;
  /** Overrides the configured port (tests use 0). */
  port?: number;
  extraOrigins?: readonly string[];
  logger?: boolean;
  /** Built web UI; defaults to `packages/daemon/public`. */
  publicDir?: string;
  /** Starts `claude`; tests pass a fake. */
  spawn?: ProcessFactory;
  /** Environment the agent inherits (minus tokens); defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/** The stdio shim the agent's CLI starts for donePM's MCP server. */
const BRIDGE_SCRIPT = fileURLToPath(new URL("./bridge/main.js", import.meta.url));

/** Built-in playbook in the repository root, copied to the global folder on first start. */
const DEFAULT_PLAYBOOK = fileURLToPath(new URL("../playbooks/implement.md", import.meta.url));

export interface Daemon {
  app: FastifyInstance;
  hub: Hub;
  db: Db;
  config: () => Config;
  /** Bound address after `start`. */
  address: () => string;
  start(): Promise<void>;
  stop(): Promise<void>;
  pollNow(): Promise<void>;
}

const withCurrentTool = (currentTool: CurrentTool | undefined) => (currentTool ? { currentTool } : {});

export async function createDaemon(opts: DaemonOptions): Promise<Daemon> {
  const paths = pathsFor(opts.home);
  let { config } = await loadConfig(paths.configFile);
  const port = opts.port ?? config.port;

  const db = openDb(paths.dbFile);
  const items = new ItemStore(db);
  const events = new EventStore(db);
  const repos = new RepoStore(db);
  const asks = new AskStore(db);
  const transcript = new TranscriptStore(db);
  const drafts = new DraftStore(db);
  // Short on purpose: a unix socket path is limited to 104 bytes on macOS and truncates silently.
  const bridgeDir = mkdtempSync(join(tmpdir(), "donepm-"));
  const bridgeSocket = join(bridgeDir, "mcp.sock");
  const bridgeSessions = new BridgeSessions();
  let bridge: { close: () => Promise<void> } | undefined;
  const status = new StatusStore(opts.version);
  const boundPort = () => {
    const a = app.server.address();
    return typeof a === "object" && a ? a.port : port;
  };
  const guard = makeGuard(boundPort, opts.extraOrigins);
  const hub = new Hub((req) => guard(req.headers));

  const view = (item: WorkItem) => {
    const itemEvents = events.forItem(item.id);
    const itemDrafts = drafts.forItem(item.id);
    return toItemView(
      item,
      item.repoId ? repos.get(item.repoId) : undefined,
      {
        ...agentHistory(itemEvents),
        running: runner.isRunning(item.id),
        ...withCurrentTool(runner.currentTool(item.id)),
      },
      attentionOf({
        state: item.state,
        agentAlive: runner.isRunning(item.id),
        hasSession: item.agentSessionId !== undefined,
        asks: asks.forItem(item.id),
        drafts: itemDrafts,
        events: itemEvents,
      }),
      itemDrafts.findLast((d) => d.state === "executed")?.result,
    );
  };
  const pushItem = (item: WorkItem) => hub.push("item.updated", view(item));
  status.onChange((s) => hub.push("status.changed", s));

  const starting = new Set<Promise<void>>();
  const writer = itemWriter({ db, items, events, onItem: pushItem, onEvent: () => {} });
  const runner = new AgentRunner({
    items,
    writer,
    asks,
    transcript,
    push: (type, payload) => hub.push(type, payload),
    ctx: opts.ctx,
    log: { info: (o, m) => app.log.info(o, m), warn: (o, m) => app.log.warn(o, m), error: (o, m) => app.log.error(o, m) },
    spawn: opts.spawn ?? spawnProcess,
    claudePath: () => status.get().claude?.path ?? "claude",
    env: () =>
      agentEnv(opts.env ?? process.env, { shimRoot: join(paths.dataDir, "bin-filtered"), emptyConfigDir: join(paths.dataDir, "no-credentials") }),
    maxConcurrent: () => config.maxConcurrentAgents,
    onCountChanged: (runningAgents) => status.update({ runningAgents }),
    onActivity: (itemId) => {
      const stored = items.get(itemId);
      if (stored) pushItem(stored.item);
    },
    mcp: (item, playbook) => {
      const token = bridgeSessions.mint({ itemId: item.id, drafts: playbook.drafts });
      const file = writeMcpConfig({
        dir: bridgeDir, itemId: item.id, nodePath: process.execPath, bridgePath: BRIDGE_SCRIPT, socketPath: bridgeSocket, token,
      });
      return {
        configPath: file.path,
        close: () => {
          bridgeSessions.revoke(token);
          file.remove();
        },
      };
    },
  });
  const draftDeps = { items, repos, drafts, writer, ctx: opts.ctx };
  failInterrupted(draftDeps);

  const worktreeRoot = () => expandHome(config.worktreeRoot, opts.home);
  const orphans = () => findOrphans({ exec: opts.exec, repos, items, worktreeRoot: worktreeRoot(), log: app.log });
  const startDeps = (): StartDeps => ({
    items, repos, writer, runner, transcript, exec: opts.exec, ctx: opts.ctx, log: app.log,
    push: (type, payload) => hub.push(type, payload),
    playbooksDir: paths.playbooksDir,
    worktreeRoot,
    branchPrefix: () => config.branchPrefix,
    sources: () => config.sources,
  });
  /** Starts still preparing their worktree; shutdown waits for them before stopping agents. */
  const track = ({ item, done }: { item: WorkItem; done: Promise<void> }) => {
    starting.add(done);
    void done.finally(() => starting.delete(done));
    return item;
  };

  const rescan = async () => {
    await discoverRepos({ root: expandHome(config.repoRoot, opts.home), exec: opts.exec, repos, ctx: opts.ctx, log: app.log });
    for (const item of relinkItems({ db, items, repos, ctx: opts.ctx })) pushItem(item);
    status.update({ lastScan: opts.ctx.now() });
  };

  const recheck = async () => {
    const [gh, claude] = await Promise.all([detectGh(opts.exec), detectClaude(opts.exec)]);
    status.update({ gh, claude });
  };

  const poller = new Poller(
    () => collectIssues({ db, exec: opts.exec, items, events, repos, status, ctx: opts.ctx, log: app.log, sources: () => config.sources, onItemUpdated: pushItem }),
    config.pollIntervalSeconds * 1000,
  );

  const app = buildServer({
    port: boundPort,
    items,
    events,
    repos,
    status,
    drafts,
    asks,
    transcript,
    getConfig: () => config,
    saveConfig: async (next) => {
      await saveConfig(paths.configFile, next);
      const prev = config;
      config = next;
      if (next.pollIntervalSeconds !== prev.pollIntervalSeconds) poller.setInterval(next.pollIntervalSeconds * 1000);
      if (next.repoRoot !== prev.repoRoot) void rescan().catch((e) => app.log.error({ err: e }, "rescan failed"));
      return { restartRequired: next.port !== prev.port };
    },
    rescan,
    recheck,
    startItem: async (id) => track(await startItem(startDeps(), id)),
    resumeItem: async (id) => track(await resumeItem(startDeps(), id)),
    removeWorktree: (id) =>
      removeItemWorktree({ items, repos, writer, exec: opts.exec, ctx: opts.ctx, agentActive: (i) => runner.isRunning(i) }, id),
    orphans,
    removeOrphan: (path) => removeOrphan({ exec: opts.exec, orphans }, path),
    stopItem: (id) => runner.stop(id),
    view,
    answerAsk: (id, answer) => runner.answer(id, answer),
    diff: (input) => itemDiff(opts.exec, input),
    testSource: (origin, query) => fetchQueryIssues(opts.exec, origin, query),
    openPath: async (path, target) => {
      const r = await opts.exec("open", target === "terminal" ? ["-a", "Terminal", path] : [path]);
      if (r.code !== 0) throw new Error(r.stderr.trim() || `open exited with ${r.code}`);
    },
    editDraft: (id, edits) => editDraft(draftDeps, id, edits),
    approveDraft: (id) =>
      approveDraft({
        ...draftDeps,
        exec: opts.exec,
        stopAgent: async (itemId) => {
          if (runner.hasProcess(itemId)) await runner.stop(itemId);
        },
      }, id),
    rejectDraft: (id, reason) =>
      rejectDraft(
        {
          ...draftDeps,
          agentAlive: (itemId) => runner.hasProcess(itemId),
          say: (itemId, text) => runner.say(itemId, text),
          resume: async (itemId, how) => track(await resumeItem(startDeps(), itemId, how)),
        },
        id,
        reason,
      ),
    publicDir: opts.publicDir ?? fileURLToPath(new URL("../public", import.meta.url)),
    ...(opts.extraOrigins ? { extraOrigins: opts.extraOrigins } : {}),
    ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
  });
  hub.attach(app.server);

  return {
    app,
    hub,
    db,
    config: () => config,
    address: () => `http://127.0.0.1:${boundPort()}`,
    async start() {
      // No agent survives a restart (spec 7.5, 9.5): settle what the last run left behind.
      failMissingWorktrees({ items, writer, ctx: opts.ctx, log: app.log });
      recoverAfterRestart({ items, asks, writer, ctx: opts.ctx, log: app.log });
      await ensureDefaultPlaybook(paths.playbooksDir, DEFAULT_PLAYBOOK).catch((e) =>
        app.log.warn({ err: e }, "could not write the default playbook"),
      );
      await app.listen({ host: "127.0.0.1", port });
      bridge = await listenBridge({ ...draftDeps, sessions: bridgeSessions, log: app.log, version: opts.version }, bridgeSocket);
      app.log.info({ configFile: paths.configFile, dbFile: paths.dbFile }, "donepm started");
      await recheck();
      if (status.get().claude?.version) app.log.info({ version: status.get().claude?.version }, "claude cli");
      try {
        await rescan();
      } catch (e) {
        app.log.error({ err: e }, "repo scan failed");
      }
      poller.start();
    },
    async stop() {
      poller.stop();
      await Promise.all(starting);
      await runner.stopAll();
      await bridge?.close();
      rmSync(bridgeDir, { recursive: true, force: true });
      hub.close();
      await app.close();
      db.close();
    },
    pollNow: () => poller.runNow(),
  };
}
