import type { Ctx, WorkItem } from "@donepm/core";
import type { FastifyInstance } from "fastify";
import { fileURLToPath } from "node:url";
import { AskStore } from "./asks/store.js";
import { detectClaude } from "./claude/detect.js";
import { loadConfig, saveConfig, type Config } from "./config/config.js";
import { expandHome, pathsFor } from "./config/paths.js";
import { openDb, type Db } from "./db/database.js";
import { DraftStore } from "./drafts/store.js";
import { EventStore } from "./events/store.js";
import { collectIssues } from "./gh/collect-issues.js";
import { detectGh } from "./gh/detect.js";
import { Poller } from "./gh/poller.js";
import { buildServer } from "./http/server.js";
import { makeGuard } from "./http/guard.js";
import { ItemStore } from "./items/store.js";
import { relinkItems } from "./items/sync.js";
import { toItemView } from "./items/view.js";
import type { Exec } from "./process/exec.js";
import { discoverRepos } from "./repos/discover.js";
import { RepoStore } from "./repos/store.js";
import { StatusStore } from "./status/status.js";
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
}

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

export async function createDaemon(opts: DaemonOptions): Promise<Daemon> {
  const paths = pathsFor(opts.home);
  let { config } = await loadConfig(paths.configFile);
  const port = opts.port ?? config.port;

  const db = openDb(paths.dbFile);
  const items = new ItemStore(db);
  const events = new EventStore(db);
  const repos = new RepoStore(db);
  const status = new StatusStore(opts.version);
  const boundPort = () => {
    const a = app.server.address();
    return typeof a === "object" && a ? a.port : port;
  };
  const guard = makeGuard(boundPort, opts.extraOrigins);
  const hub = new Hub((req) => guard(req.headers));

  const pushItem = (item: WorkItem) =>
    hub.push("item.updated", toItemView(item, item.repoId ? repos.get(item.repoId) : undefined));
  status.onChange((s) => hub.push("status.changed", s));

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
    () => collectIssues({ db, exec: opts.exec, items, events, repos, status, ctx: opts.ctx, log: app.log, onItemUpdated: pushItem }),
    config.pollIntervalSeconds * 1000,
  );

  const app = buildServer({
    port: boundPort,
    items,
    events,
    repos,
    status,
    drafts: new DraftStore(db),
    asks: new AskStore(db),
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
      await app.listen({ host: "127.0.0.1", port });
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
      hub.close();
      await app.close();
      db.close();
    },
    pollNow: () => poller.runNow(),
  };
}
