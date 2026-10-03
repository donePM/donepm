import { existsSync } from "node:fs";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import type { AskStore } from "../asks/store.js";
import { ConfigSchema, type Config } from "../config/config.js";
import type { DraftStore } from "../drafts/store.js";
import type { EventStore } from "../events/store.js";
import type { ItemStore } from "../items/store.js";
import { toItemView } from "../items/view.js";
import type { RepoStore } from "../repos/store.js";
import type { StatusStore } from "../status/status.js";
import { makeGuard } from "./guard.js";

export interface ServerDeps {
  /** The port actually bound; checked against Host and Origin. */
  port: () => number;
  items: ItemStore;
  events: EventStore;
  drafts: DraftStore;
  asks: AskStore;
  repos: RepoStore;
  status: StatusStore;
  getConfig: () => Config;
  /** Validated full config; returns what changed needs a restart. */
  saveConfig: (next: Config) => Promise<{ restartRequired: boolean }>;
  rescan: () => Promise<void>;
  /** Detect `gh` and `claude` again ("Check again" in Settings). */
  recheck: () => Promise<void>;
  /** Built web UI (`packages/web` builds into it). Served at `/` when it exists. */
  publicDir?: string;
  extraOrigins?: readonly string[];
  logger?: boolean;
}

/** Partial update; unknown keys are rejected. */
const SettingsPatch = ConfigSchema.partial().strict();

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });
  const allowed = makeGuard(deps.port, deps.extraOrigins);

  app.addHook("onRequest", async (req, reply) => {
    if (!allowed(req.headers)) return reply.code(403).send({ error: "forbidden" });
  });

  app.get("/api/items", async () =>
    deps.items.all().map(({ item }) => toItemView(item, item.repoId ? deps.repos.get(item.repoId) : undefined)),
  );

  app.get<{ Params: { id: string } }>("/api/items/:id", async (req, reply) => {
    const stored = deps.items.get(req.params.id);
    if (!stored) return reply.code(404).send({ error: "item not found" });
    const { item } = stored;
    return {
      ...toItemView(item, item.repoId ? deps.repos.get(item.repoId) : undefined),
      events: deps.events.forItem(item.id),
      drafts: deps.drafts.forItem(item.id),
      asks: deps.asks.forItem(item.id),
    };
  });

  app.get("/api/repos", async () => deps.repos.all());

  app.post("/api/repos/rescan", async () => {
    await deps.rescan();
    return deps.repos.all();
  });

  app.get("/api/status", async () => deps.status.get());

  app.post("/api/status/recheck", async () => {
    await deps.recheck();
    return deps.status.get();
  });

  app.get("/api/settings", async () => deps.getConfig());

  app.put("/api/settings", async (req, reply) => {
    const patch = SettingsPatch.safeParse(req.body ?? {});
    if (!patch.success) {
      return reply.code(400).send({ error: "invalid settings", issues: patch.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    }
    const next = ConfigSchema.parse({ ...deps.getConfig(), ...patch.data });
    const { restartRequired } = await deps.saveConfig(next);
    return { settings: next, restartRequired };
  });

  const ui = deps.publicDir && existsSync(join(deps.publicDir, "index.html")) ? deps.publicDir : undefined;
  // Wildcard mode looks files up per request, so a rebuild of the UI needs no daemon restart.
  if (ui) app.register(fastifyStatic, { root: ui });

  app.setNotFoundHandler(async (req, reply) => {
    // Client-side routes (/settings, /agents) get the app shell; the router takes it from there.
    if (ui && req.method === "GET" && !req.url.startsWith("/api/")) return reply.sendFile("index.html");
    return reply.code(404).send({ error: "not found" });
  });

  return app;
}
