import { existsSync } from "node:fs";
import { join } from "node:path";
import { AGENT_KINDS, MERGE_METHODS, type AgentKind, type Draft, type MergeMethod, type PermissionGrant, type PrDraftPayload, type WorkItem } from "@donepm/core";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { z } from "zod";
import { AskError, StopError } from "../agent/runner.js";
import { StartError } from "../agent/start.js";
import { WorktreeError } from "../worktrees/create.js";
import type { OrphanDetails } from "../worktrees/orphan-details.js";
import type { PlaybookList } from "../playbooks/list.js";
import type { DaemonInfo } from "../system/info.js";
import type { MoveOutcome, WorktreeAtOldRoot } from "../worktrees/move.js";
import { RemoveError } from "../worktrees/remove.js";
import { DismissError } from "../items/dismiss.js";
import { PlaybookChangeError } from "../items/playbook.js";
import { AgentChangeError } from "../items/agent-choice.js";
import { SayError } from "../agent/say.js";
import { CiActionError } from "../ci/actions.js";
import { PrActionError } from "../prs/actions.js";
import { GrantError } from "../asks/revoke.js";
import type { AskStore } from "../asks/store.js";
import { ConfigSchema, noConnectionFor, SourceKey, ValidConfigSchema, type Config } from "../config/config.js";
import { connectionFor, connectionsOf } from "../config/connections.js";
import { DraftError } from "../drafts/actions.js";
import { ExecutionError } from "../drafts/execute.js";
import type { DraftStore } from "../drafts/store.js";
import type { ItemDiff } from "../diff/item-diff.js";
import type { EventStore } from "../events/store.js";
import type { FetchResult } from "../providers/ticket-source.js";
import type { ItemStore, StoredItem } from "../items/store.js";
import type { ItemView } from "../items/view.js";
import { CloneError } from "../repos/clone.js";
import { isManaged, withManaged } from "../repos/managed.js";
import type { RepoStore } from "../repos/store.js";
import type { StatusStore } from "../status/status.js";
import type { TranscriptStore } from "../transcript/store.js";
import { connectionRoutes, type ConnectionRouteDeps } from "./connection-routes.js";
import { makeGuard } from "./guard.js";

export interface ServerDeps extends ConnectionRouteDeps {
  /** The port actually bound; checked against Host and Origin. */
  port: () => number;
  items: ItemStore;
  events: EventStore;
  drafts: DraftStore;
  asks: AskStore;
  transcript: TranscriptStore;
  repos: RepoStore;
  status: StatusStore;
  /** The item belongs on the board: its repository is managed, or it still needs attention (D46). */
  onBoard: (stored: StoredItem) => boolean;
  getConfig: () => Config;
  /**
   * Validated full config; returns what changed needs a restart. Pushes the items a managed change
   * shows or hides, and polls when a repository became managed. With a changed worktree root and `"move"`, moves the item worktrees under the
   * old root and returns what moved and what was skipped (issue #93).
   */
  saveConfig: (next: Config, worktrees?: WorktreeChoice) => Promise<{ restartRequired: boolean; worktrees?: MoveOutcome }>;
  /** Item worktrees under the current root if `next` changes the root; empty otherwise. */
  worktreesAtOldRoot: (next: Config) => WorktreeAtOldRoot[];
  rescan: () => Promise<void>;
  /**
   * Throws CloneError. `cloned`: a clone of the origin was at the target and is registered now.
   * `started`: `gh repo clone` runs; `repo.*` pushes tell how it ends (issue #37). Either way the
   * origin is managed from then on (D46).
   */
  cloneRepo: (origin: string) => Promise<{ target: string; result: "cloned" | "started" }>;
  /** Detect `gh` and `claude` again ("Check again" in Settings). */
  recheck: () => Promise<void>;
  /** Throws StartError; resolves once the item is `running`, the rest happens in the background. */
  startItem: (id: string) => Promise<unknown>;
  /** Same contract as startItem, for a waiting item whose process is gone (`--resume`). */
  resumeItem: (id: string) => Promise<unknown>;
  /** Throws RemoveError or WorktreeError. Resolves with the item once git is done. */
  removeWorktree: (id: string) => Promise<WorkItem>;
  /** Worktrees under donePM's root that no item uses, with size and last commit. */
  orphans: () => Promise<OrphanDetails[]>;
  /** Throws RemoveError (404 for paths that are not orphans) or WorktreeError. */
  removeOrphan: (path: string) => Promise<void>;
  /** Throws DismissError. Moves an item whose issue was closed upstream to Done (D32). */
  dismissItem: (id: string) => WorkItem;
  /** Throws CiActionError. "Rerun failed jobs" on a red CI; resolves once gh reran them (D35). */
  rerunCi: (id: string) => Promise<WorkItem>;
  /** Throws CiActionError. Moves an item waiting for or failed by CI to Done. */
  markCiDone: (id: string) => WorkItem;
  /** Throws CiActionError or StartError; same contract as resumeItem, with the failures as the message. */
  fixCi: (id: string) => Promise<unknown>;
  /** Throws PrActionError or StartError. Fetches the base and resumes the agent on a PR's merge conflict (D36). */
  resolveConflict: (id: string) => Promise<unknown>;
  /** Throws PrActionError. "I'll do it myself": the item goes back to where it was. */
  dismissConflict: (id: string) => WorkItem;
  /** Throws PrActionError or StartError. Resumes the agent on review feedback of the item's PR (D39). */
  addressFeedback: (id: string) => Promise<unknown>;
  /** Throws PrActionError. "Mark done": the item is done again despite the feedback. */
  dismissFeedback: (id: string) => WorkItem;
  /** Throws PrActionError. Posts the user's comment on someone else's pull request (D47). */
  commentOnPr: (id: string, body: string) => Promise<WorkItem>;
  mergePr: (id: string, method: MergeMethod) => Promise<WorkItem>;
  /** The card's "Update branch" (#148). */
  updatePrBranch: (id: string) => Promise<WorkItem>;
  setAutoMerge: (id: string, on: boolean) => WorkItem;
  /** Throws PlaybookChangeError. The playbook dropdown on a Ready card. */
  changePlaybook: (id: string, playbook: string) => Promise<WorkItem>;
  /** Throws AgentChangeError. The agent dropdown on a Ready or Failed card (issue #137). */
  changeAgent: (id: string, agent: AgentKind) => Promise<WorkItem>;
  /** Throws SayError. A note from the composer that joins the running turn. */
  sayToAgent: (id: string, text: string) => void;
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
  /** "Always allow" grants in force, every repository (D38). */
  grants: () => PermissionGrant[];
  /** Throws GrantError (404 for a missing or removed grant). The grant stops matching at once. */
  revokeGrant: (id: string) => PermissionGrant;
  /** Runs a repository query once, for the Test button in Settings (issue #32). */
  testSource: (origin: string, query: string) => Promise<FetchResult>;
  /** Global and repository playbooks for Settings (issue #127). */
  playbooks: () => Promise<PlaybookList>;
  /** Version, port, files and how the daemon was started (Settings > Daemon). */
  daemonInfo: () => DaemonInfo;
  /** Exits so launchd starts the daemon again; absent when it was started by hand. */
  restart?: () => void;
  /** Built web UI (`packages/web` builds into it). Served at `/` when it exists. */
  publicDir?: string;
  extraOrigins?: readonly string[];
  logger?: boolean;
}

const AskAnswerSchema = z.discriminatedUnion("behavior", [
  // `scope: "run"` also grants the rules the CLI suggested for the rest of the run; `"always"` stores
  // them as grants of the item's repository (D38).
  z.object({
    behavior: z.literal("allow"),
    scope: z.enum(["run", "always"]).optional(),
    answers: z.record(z.string(), z.string()).optional(),
  }).strict(),
  z.object({ behavior: z.literal("deny"), message: z.string().optional(), interrupt: z.boolean().optional() }).strict(),
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

const DaemonOpenSchema = z.object({ what: z.enum(["logs", "playbooks"]) }).strict();

const RepoPatchSchema = z.object({ managed: z.boolean() }).strict();

const RepoCloneSchema = z.object({ origin: z.string().min(1) }).strict();

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

async function ciCall<T>(reply: FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CiActionError || e instanceof PrActionError || e instanceof StartError) return reply.code(e.status).send({ error: e.message });
    throw e;
  }
}

const PrCommentSchema = z.object({ body: z.string() }).strict();

const PrMergeSchema = z.object({ method: z.enum(MERGE_METHODS) }).strict();

const AutoMergeSchema = z.object({ on: z.boolean() }).strict();

const PlaybookSchema = z.object({ playbook: z.string().trim().min(1) }).strict();
const AgentSchema = z.object({ agent: z.enum(AGENT_KINDS) }).strict();

const SaySchema = z.object({ text: z.string() }).strict();

const DraftRejectSchema = z.object({ reason: z.string().optional() }).strict();

function issuesText(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
}

const SourceTestSchema = z.object({ origin: SourceKey, query: z.string().trim().min(1) }).strict();

/** How many matches the Test button lists. */
const SOURCE_TEST_SAMPLE = 10;

/** Partial update; unknown keys are rejected. */
/** `previousWorktreeRoots` is the daemon's bookkeeping (issue #93), not a setting. */
const SettingsPatch = ConfigSchema.omit({ previousWorktreeRoots: true }).partial().strict();

/** What happens to the worktrees under the old root when `worktreeRoot` changes (issue #93). */
const WorktreeChoiceSchema = z.object({ worktrees: z.enum(["move", "leave"]).optional() });
export type WorktreeChoice = "move" | "leave";

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

  app.get("/api/items", async () =>
    deps.items.all().filter(deps.onBoard).map(({ item }) => deps.view(item)),
  );

  /** Archived items, the most recently archived first (D37). The web filters them. */
  app.get("/api/archive", async () => deps.items.archived().map(({ item }) => deps.view(item)));

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

  app.post<{ Params: { id: string } }>("/api/items/:id/dismiss", async (req, reply) => {
    try {
      return deps.view(deps.dismissItem(req.params.id));
    } catch (e) {
      if (e instanceof DismissError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });

  app.post<{ Params: { id: string } }>("/api/items/:id/ci/rerun", async (req, reply) =>
    ciCall(reply, async () => deps.view(await deps.rerunCi(req.params.id))),
  );

  app.post<{ Params: { id: string } }>("/api/items/:id/ci/done", async (req, reply) =>
    ciCall(reply, async () => deps.view(deps.markCiDone(req.params.id))),
  );

  app.post<{ Params: { id: string } }>("/api/items/:id/ci/fix", async (req, reply) => {
    const r = await ciCall(reply, () => deps.fixCi(req.params.id));
    return reply.sent ? r : reply.code(202).send(r);
  });

  app.post<{ Params: { id: string } }>("/api/items/:id/conflict/resolve", async (req, reply) => {
    const r = await ciCall(reply, () => deps.resolveConflict(req.params.id));
    return reply.sent ? r : reply.code(202).send(r);
  });

  app.post<{ Params: { id: string } }>("/api/items/:id/conflict/dismiss", async (req, reply) =>
    ciCall(reply, async () => deps.view(deps.dismissConflict(req.params.id))),
  );

  app.post<{ Params: { id: string } }>("/api/items/:id/feedback/address", async (req, reply) => {
    const r = await ciCall(reply, () => deps.addressFeedback(req.params.id));
    return reply.sent ? r : reply.code(202).send(r);
  });

  app.post<{ Params: { id: string } }>("/api/items/:id/feedback/dismiss", async (req, reply) =>
    ciCall(reply, async () => deps.view(deps.dismissFeedback(req.params.id))),
  );

  app.post<{ Params: { id: string } }>("/api/items/:id/pr/comment", async (req, reply) => {
    const parsed = PrCommentSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "body must be {body: string}" });
    return ciCall(reply, async () => deps.view(await deps.commentOnPr(req.params.id, parsed.data.body)));
  });

  app.post<{ Params: { id: string } }>("/api/items/:id/pr/merge", async (req, reply) => {
    const parsed = PrMergeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: `body must be {method: ${MERGE_METHODS.join("|")}}` });
    return ciCall(reply, async () => deps.view(await deps.mergePr(req.params.id, parsed.data.method)));
  });

  app.post<{ Params: { id: string } }>("/api/items/:id/pr/update-branch", async (req, reply) =>
    ciCall(reply, async () => deps.view(await deps.updatePrBranch(req.params.id))),
  );

  app.put<{ Params: { id: string } }>("/api/items/:id/auto-merge", async (req, reply) => {
    const parsed = AutoMergeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "body must be {on: boolean}" });
    return ciCall(reply, async () => deps.view(deps.setAutoMerge(req.params.id, parsed.data.on)));
  });

  app.put<{ Params: { id: string } }>("/api/items/:id/playbook", async (req, reply) => {
    const parsed = PlaybookSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "body must be {playbook: string}" });
    try {
      return deps.view(await deps.changePlaybook(req.params.id, parsed.data.playbook));
    } catch (e) {
      if (e instanceof PlaybookChangeError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });

  app.put<{ Params: { id: string } }>("/api/items/:id/agent", async (req, reply) => {
    const parsed = AgentSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: `body must be {agent: ${AGENT_KINDS.map((k) => `"${k}"`).join(" | ")}}` });
    try {
      return deps.view(await deps.changeAgent(req.params.id, parsed.data.agent));
    } catch (e) {
      if (e instanceof AgentChangeError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });

  app.post<{ Params: { id: string } }>("/api/items/:id/say", async (req, reply) => {
    const parsed = SaySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "body must be {text: string}" });
    try {
      deps.sayToAgent(req.params.id, parsed.data.text);
      return { ok: true };
    } catch (e) {
      if (e instanceof SayError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
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
    // A pull request under review compares against its own base, not the repo's default (D41).
    return deps.diff({ worktreePath: item.worktreePath, branch: item.branch, defaultBranch: item.baseBranch ?? repo.defaultBranch });
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
    if (!answer.success) return reply.code(400).send({ error: "body must be {behavior: allow, scope?: run|always, answers?} or {behavior: deny, message?, interrupt?}" });
    try {
      deps.answerAsk(req.params.id, answer.data);
    } catch (e) {
      if (e instanceof AskError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
    return { ok: true };
  });

  app.get("/api/grants", async () => deps.grants());

  app.post<{ Params: { id: string } }>("/api/grants/:id/revoke", async (req, reply) => {
    try {
      return deps.revokeGrant(req.params.id);
    } catch (e) {
      if (e instanceof GrantError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
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

  const repoViews = () => {
    const { sources } = deps.getConfig();
    const worktrees = new Map<string, number>();
    for (const { item } of deps.items.all()) {
      if (item.repoId && item.worktreePath) worktrees.set(item.repoId, (worktrees.get(item.repoId) ?? 0) + 1);
    }
    return deps.repos.all().map((r) => ({ ...r, managed: isManaged(sources, r.originUrl), worktrees: worktrees.get(r.id) ?? 0 }));
  };

  app.get("/api/repos", async () => repoViews());

  app.post("/api/repos/rescan", async () => {
    await deps.rescan();
    return repoViews();
  });

  app.post("/api/repos/clone", async (req, reply) => {
    const body = RepoCloneSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "body must be {origin: string}" });
    try {
      const { target, result } = await deps.cloneRepo(body.data.origin);
      return reply.code(result === "started" ? 202 : 200).send({ origin: body.data.origin, path: target, result });
    } catch (e) {
      if (e instanceof CloneError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });

  // The flag belongs to the origin, so every clone of it changes together.
  app.put<{ Params: { id: string } }>("/api/repos/:id", async (req, reply) => {
    const body = RepoPatchSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "body must be {managed: boolean}" });
    const repo = deps.repos.get(req.params.id);
    if (!repo) return reply.code(404).send({ error: "repository not found" });
    const parsed = ValidConfigSchema.safeParse({
      ...deps.getConfig(),
      sources: withManaged(deps.getConfig().sources, repo.originUrl, body.data.managed),
    });
    if (!parsed.success) return reply.code(400).send({ error: issuesText(parsed.error.issues) });
    const settings = parsed.data;
    await deps.saveConfig(settings);
    return { repos: repoViews(), settings };
  });

  app.post("/api/sources/test", async (req, reply) => {
    const body = SourceTestSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: issuesText(body.error.issues) });
    if (!connectionFor(connectionsOf(deps.getConfig()), body.data.origin)) return reply.code(400).send({ error: noConnectionFor(body.data.origin) });
    const r = await deps.testSource(body.data.origin, body.data.query);
    if (!r.ok) return reply.code(502).send({ error: r.error });
    return {
      count: r.issues.length,
      issues: r.issues.slice(0, SOURCE_TEST_SAMPLE).map(({ number, title, url }) => ({ number, title, url })),
    };
  });

  app.get("/api/status", async () => deps.status.get());

  app.post("/api/status/recheck", async () => {
    await deps.recheck();
    return deps.status.get();
  });

  connectionRoutes(app, deps);

  app.get("/api/settings", async () => deps.getConfig());

  app.get("/api/playbooks", async () => deps.playbooks());

  app.get("/api/daemon", async () => deps.daemonInfo());

  app.post("/api/daemon/restart", async (_req, reply) => {
    const restart = deps.restart;
    if (!restart) return reply.code(409).send({ error: "donePM was started by hand: stop it and run `donepm start` again" });
    // After the answer is out: the restart closes the server.
    reply.raw.once("finish", () => setImmediate(restart));
    return reply.code(202).send({ ok: true });
  });

  app.post("/api/daemon/open", async (req, reply) => {
    const body = DaemonOpenSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "body must be {what: logs|playbooks}" });
    const info = deps.daemonInfo();
    const path = body.data.what === "logs" ? info.logFile : info.playbooksDir;
    if (!path || !existsSync(path)) return reply.code(409).send({ error: body.data.what === "logs" ? "no log file: donePM logs to the terminal it was started in" : `${path} does not exist` });
    await deps.openPath(path, "finder");
    return { ok: true };
  });

  app.put("/api/settings", async (req, reply) => {
    const patch = SettingsPatch.safeParse(req.body ?? {});
    if (!patch.success) {
      return reply.code(400).send({ error: "invalid settings", issues: patch.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    }
    const choice = WorktreeChoiceSchema.safeParse(req.query ?? {});
    if (!choice.success) return reply.code(400).send({ error: "worktrees must be move or leave" });
    const parsed = ValidConfigSchema.safeParse({ ...deps.getConfig(), ...patch.data });
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid settings", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    }
    const next = parsed.data;
    // A new worktree root with worktrees under the old one: nothing is saved until the user chose.
    const atOldRoot = deps.worktreesAtOldRoot(next);
    if (atOldRoot.length && !choice.data.worktrees) {
      return reply.code(409).send({ error: `${atOldRoot.length} worktrees are in the old location`, worktreesAtOldRoot: atOldRoot });
    }
    const { restartRequired, worktrees } = await deps.saveConfig(next, choice.data.worktrees);
    return { settings: deps.getConfig(), restartRequired, ...(worktrees ? { worktrees } : {}) };
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
