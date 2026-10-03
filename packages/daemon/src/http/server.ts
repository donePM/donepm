import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Draft, PrDraftPayload, WorkItem } from "@donepm/core";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { z } from "zod";
import { AskError, StopError } from "../agent/runner.js";
import { StartError } from "../agent/start.js";
import { WorktreeError } from "../worktrees/create.js";
import type { OrphanWorktree } from "../worktrees/reconcile.js";
import { RemoveError } from "../worktrees/remove.js";
import type { AskStore } from "../asks/store.js";
import { ConfigSchema, type Config } from "../config/config.js";
import { DraftError } from "../drafts/actions.js";
import { ExecutionError } from "../drafts/execute.js";
import type { DraftStore } from "../drafts/store.js";
import type { ItemDiff } from "../diff/item-diff.js";
import type { EventStore } from "../events/store.js";
import type { ItemStore } from "../items/store.js";
import type { ItemView } from "../items/view.js";
import type { RepoStore } from "../repos/store.js";
import type { StatusStore } from "../status/status.js";
import type { TranscriptStore } from "../transcript/store.js";
import { makeGuard } from "./guard.js";

export interface ServerDeps {
  /** The port actually bound; checked against Host and Origin. */
  port: () => number;
  items: ItemStore;
  events: EventStore;
  drafts: DraftStore;
  asks: AskStore;
  transcript: TranscriptStore;
  repos: RepoStore;
  status: StatusStore;
  getConfig: () => Config;
  /** Validated full config; returns what changed needs a restart. */
  saveConfig: (next: Config) => Promise<{ restartRequired: boolean }>;
  rescan: () => Promise<void>;
  /** Detect `gh` and `claude` again ("Check again" in Settings). */
  recheck: () => Promise<void>;
  /** Throws StartError; resolves once the item is `running`, the rest happens in the background. */
  startItem: (id: string) => Promise<unknown>;
  /** Same contract as startItem, for a waiting item whose process is gone (`--resume`). */
  resumeItem: (id: string) => Promise<unknown>;
  /** Throws RemoveError or WorktreeError. Resolves with the item once git is done. */
  removeWorktree: (id: string) => Promise<WorkItem>;
  /** Worktrees under donePM's root that no item uses. */
  orphans: () => Promise<OrphanWorktree[]>;
  /** Throws RemoveError (404 for paths that are not orphans) or WorktreeError. */
  removeOrphan: (path: string) => Promise<void>;
  /** Throws StopError when no agent process is alive. Resolves once it exited. */
  stopItem: (id: string) => Promise<void>;
  /** The item as the API shows it: clone, badges, agent. */
  view: (item: WorkItem) => ItemView;
  /** Throws DraftError. */
  editDraft: (id: string, edits: Partial<PrDraftPayload>) => Draft;
  /** Throws DraftError. The reason goes to the agent as its next message. */
  /** Throws DraftError, or StartError when the agent is gone and its session cannot resume. */
  rejectDraft: (id: string, reason: string | undefined) => Promise<Draft>;
  /** Throws DraftError before, ExecutionError after anything ran. Resolves once the PR exists. */
  approveDraft: (id: string) => Promise<Draft>;
  /** Branch against base, committed and uncommitted. Rejects with DiffError. */
  diff: (input: { worktreePath: string; branch: string; defaultBranch: string }) => Promise<ItemDiff>;
  /** Opens a folder on the user's machine (Finder, Terminal). */
  openPath: (path: string, target: OpenTarget) => Promise<void>;
  /** Throws AskError. */
  answerAsk: (id: string, answer: AskAnswer) => void;
  /** Built web UI (`packages/web` builds into it). Served at `/` when it exists. */
  publicDir?: string;
  extraOrigins?: readonly string[];
  logger?: boolean;
}

const AskAnswerSchema = z.discriminatedUnion("behavior", [
  z.object({ behavior: z.literal("allow") }).strict(),
  z.object({ behavior: z.literal("deny"), message: z.string().optional() }).strict(),
]);
export type AskAnswer = z.infer<typeof AskAnswerSchema>;

const DraftEditSchema = z
  .object({
    payload: z
      .object({ title: z.string().trim().min(1), body: z.string(), base: z.string().trim().min(1) })
      .partial()
      .strict(),
  })
  .strict();

const OpenSchema = z.object({ target: z.enum(["finder", "terminal"]) }).strict();
export type OpenTarget = z.infer<typeof OpenSchema>["target"];

const OrphanRemoveSchema = z.object({ path: z.string().min(1) }).strict();

async function removeCall<T>(reply: FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof RemoveError) return reply.code(e.status).send({ error: e.message });
    if (e instanceof WorktreeError) return reply.code(502).send({ error: e.output.trim() ? `${e.message}: ${e.output.trim()}` : e.message });
    throw e;
  }
}

const DraftRejectSchema = z.object({ reason: z.string().optional() }).strict();

/** Partial update; unknown keys are rejected. */
const SettingsPatch = ConfigSchema.partial().strict();

async function draftCall(reply: FastifyReply, fn: () => Draft | Promise<Draft>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof DraftError || e instanceof StartError) return reply.code(e.status).send({ error: e.message });
    throw e;
  }
}

function stripUndefined<T extends object>(o: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as never;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });
  const allowed = makeGuard(deps.port, deps.extraOrigins);

  app.addHook("onRequest", async (req, reply) => {
    if (!allowed(req.headers)) return reply.code(403).send({ error: "forbidden" });
  });

  app.get("/api/items", async () => deps.items.all().map(({ item }) => deps.view(item)));

  app.get<{ Params: { id: string } }>("/api/items/:id", async (req, reply) => {
    const stored = deps.items.get(req.params.id);
    if (!stored) return reply.code(404).send({ error: "item not found" });
    const { item } = stored;
    return {
      ...deps.view(item),
      events: deps.events.forItem(item.id),
      drafts: deps.drafts.forItem(item.id),
      asks: deps.asks.forItem(item.id),
    };
  });

  app.post<{ Params: { id: string } }>("/api/items/:id/start", async (req, reply) => {
    try {
      return reply.code(202).send(await deps.startItem(req.params.id));
    } catch (e) {
      if (e instanceof StartError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });

  app.post<{ Params: { id: string } }>("/api/items/:id/resume", async (req, reply) => {
    try {
      return reply.code(202).send(await deps.resumeItem(req.params.id));
    } catch (e) {
      if (e instanceof StartError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });

  app.post<{ Params: { id: string } }>("/api/items/:id/worktree/remove", async (req, reply) =>
    removeCall(reply, async () => deps.view(await deps.removeWorktree(req.params.id))),
  );

  app.get("/api/worktrees/orphaned", async () => deps.orphans());

  app.post("/api/worktrees/orphaned/remove", async (req, reply) => {
    const body = OrphanRemoveSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "body must be {path: string}" });
    return removeCall(reply, async () => {
      await deps.removeOrphan(body.data.path);
      return { ok: true };
    });
  });

  app.post<{ Params: { id: string } }>("/api/items/:id/stop", async (req, reply) => {
    if (!deps.items.get(req.params.id)) return reply.code(404).send({ error: "item not found" });
    try {
      await deps.stopItem(req.params.id);
    } catch (e) {
      if (e instanceof StopError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
    return deps.view(deps.items.get(req.params.id)!.item);
  });

  app.get<{ Params: { id: string }; Querystring: { after?: string } }>("/api/items/:id/transcript", async (req, reply) => {
    if (!deps.items.get(req.params.id)) return reply.code(404).send({ error: "item not found" });
    return deps.transcript.page(req.params.id, req.query.after || undefined);
  });

  app.get<{ Params: { id: string } }>("/api/items/:id/diff", async (req, reply) => {
    const item = deps.items.get(req.params.id)?.item;
    if (!item) return reply.code(404).send({ error: "item not found" });
    const repo = item.repoId ? deps.repos.get(item.repoId) : undefined;
    if (!repo || !item.worktreePath || !item.branch || !existsSync(item.worktreePath)) {
      return reply.code(409).send({ error: "the item has no worktree" });
    }
    return deps.diff({ worktreePath: item.worktreePath, branch: item.branch, defaultBranch: repo.defaultBranch });
  });

  app.post<{ Params: { id: string } }>("/api/items/:id/open", async (req, reply) => {
    const body = OpenSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "body must be {target: finder|terminal}" });
    const item = deps.items.get(req.params.id)?.item;
    if (!item) return reply.code(404).send({ error: "item not found" });
    if (!item.worktreePath || !existsSync(item.worktreePath)) return reply.code(409).send({ error: "the item has no worktree" });
    await deps.openPath(item.worktreePath, body.data.target);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/asks/:id/answer", async (req, reply) => {
    const answer = AskAnswerSchema.safeParse(req.body ?? {});
    if (!answer.success) return reply.code(400).send({ error: "body must be {behavior: allow} or {behavior: deny, message?}" });
    try {
      deps.answerAsk(req.params.id, answer.data);
    } catch (e) {
      if (e instanceof AskError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/drafts/:id/edit", async (req, reply) => {
    const body = DraftEditSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "body must be {payload: {title?, body?, base?}}" });
    return draftCall(reply, () => deps.editDraft(req.params.id, stripUndefined(body.data.payload)));
  });

  app.post<{ Params: { id: string } }>("/api/drafts/:id/reject", async (req, reply) => {
    const body = DraftRejectSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "body must be {reason?: string}" });
    return draftCall(reply, () => deps.rejectDraft(req.params.id, body.data.reason?.trim() || undefined));
  });

  app.post<{ Params: { id: string } }>("/api/drafts/:id/approve", async (req, reply) => {
    try {
      return await deps.approveDraft(req.params.id);
    } catch (e) {
      if (e instanceof DraftError) return reply.code(e.status).send({ error: e.message });
      // git or gh failed: the draft is `failed` and the item waits for a retry.
      if (e instanceof ExecutionError) return reply.code(502).send({ error: e.message, step: e.step });
      throw e;
    }
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
