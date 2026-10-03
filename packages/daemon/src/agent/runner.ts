import {
  agentAsked, agentFailed, answered, toolSummary, turnEnded, turnStarted,
  type Ctx, type Playbook, type TranscriptKind, type WorkItem,
} from "@donepm/core";
import type { AskStore } from "../asks/store.js";
import type { ItemStore } from "../items/store.js";
import type { ItemWriter } from "../items/commit.js";
import type { CurrentTool } from "../items/view.js";
import type { Log } from "../log.js";
import type { TranscriptStore } from "../transcript/store.js";
import type { PushType } from "../ws/hub.js";
import { askAnswerLine, claudeArgv, userTurnLine } from "./argv.js";
import { decodeLine } from "./decode.js";
import type { AgentProcess, ProcessFactory } from "./process.js";

export const STDERR_TAIL_LINES = 50;
export const KILL_GRACE_MS = 5_000;

export interface RunnerDeps {
  items: ItemStore;
  writer: ItemWriter;
  asks: AskStore;
  transcript: TranscriptStore;
  push: (type: PushType, payload: unknown) => void;
  ctx: Ctx;
  log: Log;
  spawn: ProcessFactory;
  /** Path of the `claude` binary. */
  claudePath: () => string;
  /** Environment for the agent: filtered `PATH`, no tokens. */
  env: () => Promise<NodeJS.ProcessEnv>;
  maxConcurrent: () => number;
  /** Reports the number of live sessions (status bar). */
  onCountChanged?: (running: number) => void;
  /** The current tool of an item changed; the board shows it. */
  onActivity?: (itemId: string) => void;
  /** Opens the draft gate for one process: writes its `--mcp-config` file, `close` revokes it. */
  mcp?: (item: WorkItem, playbook: Playbook) => { configPath: string; close: () => void };
}

export interface LaunchInput {
  item: WorkItem;
  playbook: Playbook;
  cwd: string;
  /** First user message (spec 9.2). */
  prompt: string;
  resumeSessionId?: string;
}

interface Session {
  itemId: string;
  proc?: AgentProcess;
  sessionId?: string;
  /** A `result` closed the latest turn. Reset on every `init`. */
  turnClosed: boolean;
  stderr: string[];
  /** Shutdown of the daemon: the item keeps its state. */
  stopping: boolean;
  /** The user pressed Stop: the item fails with a reason it can be retried from. */
  stoppedByUser: boolean;
  done: boolean;
  /** Tool calls without a result yet, by tool_use id, in call order. */
  tools: Map<string, CurrentTool>;
  exited?: Promise<void>;
}

export class AgentBusyError extends Error {
  constructor(readonly max: number) {
    super(`${max} agent${max === 1 ? " is" : "s are"} already running. Wait for one to finish.`);
    this.name = "AgentBusyError";
  }
}

/**
 * Runs one `claude` process per item (spec 9). Reads stdout line by line, stores what it reads,
 * and moves the item through the core transitions. Never fails on an unknown line.
 */
export class AgentRunner {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly deps: RunnerDeps) {}

  get count(): number {
    return this.sessions.size;
  }

  isRunning(itemId: string): boolean {
    return this.sessions.has(itemId);
  }

  /** A `claude` process is alive for the item (a reserved slot still preparing does not count). */
  hasProcess(itemId: string): boolean {
    return this.sessions.get(itemId)?.proc !== undefined;
  }

  /** The latest tool call still waiting for its result. */
  currentTool(itemId: string): CurrentTool | undefined {
    const tools = this.sessions.get(itemId)?.tools;
    return tools ? [...tools.values()].at(-1) : undefined;
  }

  /**
   * Hold a slot before the slow part (worktree, setup) starts, so two quick clicks cannot both get
   * past the limit. Throws AgentBusyError when full. `release` is for a start that fails early.
   */
  reserve(itemId: string): { release: () => void } {
    if (this.sessions.has(itemId)) throw new Error("agent already running for this item");
    if (this.sessions.size >= this.deps.maxConcurrent()) throw new AgentBusyError(this.deps.maxConcurrent());
    this.sessions.set(itemId, {
      itemId, turnClosed: false, stderr: [], stopping: false, stoppedByUser: false, done: false, tools: new Map(),
    });
    this.countChanged();
    return {
      release: () => {
        if (!this.sessions.get(itemId)?.proc) {
          this.sessions.delete(itemId);
          this.countChanged();
        }
      },
    };
  }

  /** Spawn the agent in a reserved slot and send the first message. */
  async launch(input: LaunchInput): Promise<void> {
    const session = this.sessions.get(input.item.id);
    if (!session) throw new Error("launch without reserve");
    const env = await this.deps.env();
    const mcp = this.deps.mcp?.(input.item, input.playbook);
    const args = claudeArgv({
      playbook: input.playbook,
      ...(mcp ? { mcpConfigPath: mcp.configPath } : {}),
      ...(input.resumeSessionId ? { resumeSessionId: input.resumeSessionId } : {}),
      ...(env.HOME ? { home: env.HOME } : {}),
    });
    const proc = this.deps.spawn(this.deps.claudePath(), args, { cwd: input.cwd, env });
    session.proc = proc;
    if (input.resumeSessionId) session.sessionId = input.resumeSessionId;

    session.exited = new Promise((resolve) => {
      proc.onExit((code, signal) => {
        mcp?.close();
        this.exited(session, code, signal);
        resolve();
      });
    });
    proc.onStderr((chunk) => {
      session.stderr.push(...chunk.split("\n").filter((l) => l !== ""));
      if (session.stderr.length > STDERR_TAIL_LINES) session.stderr.splice(0, session.stderr.length - STDERR_TAIL_LINES);
    });
    proc.onStdoutLine((line) => {
      try {
        this.ingest(session, line);
      } catch (e) {
        // A bug in handling one line must not take the session down; the raw line is in the log.
        this.deps.log.error({ err: e, itemId: session.itemId }, "failed to handle agent line");
      }
    });

    const line = userTurnLine(input.prompt);
    proc.write(line);
    this.store(session, "user", JSON.parse(line));
  }

  /** Send the agent its next user message, e.g. the reason a draft was rejected. */
  say(itemId: string, text: string): void {
    const session = this.sessions.get(itemId);
    if (!session?.proc) throw new Error("the agent for this item is not running");
    const line = userTurnLine(text);
    session.proc.write(line);
    this.store(session, "user", JSON.parse(line));
  }

  /** Answer a pending permission question (spec 9.4). */
  answer(askId: string, answer: { behavior: "allow" } | { behavior: "deny"; message?: string }): void {
    const ask = this.deps.asks.get(askId);
    if (!ask) throw new AskError(404, "ask not found");
    if (ask.state !== "pending") throw new AskError(409, `ask already ${ask.state}`);
    const session = this.sessions.get(ask.itemId);
    if (!session?.proc) throw new AskError(409, "the agent for this item is not running");

    const line =
      answer.behavior === "allow"
        ? askAnswerLine(ask.requestId, { behavior: "allow", input: ask.input })
        : askAnswerLine(ask.requestId, { behavior: "deny", message: answer.message || "The user denied this." });
    session.proc.write(line);
    const at = this.deps.ctx.now();
    this.deps.asks.setState(ask.id, answer.behavior === "allow" ? "allowed" : "denied", at);
    this.store(session, "raw", JSON.parse(line));

    const item = this.item(ask.itemId);
    if (item.state === "needs_you") {
      const others = this.deps.asks.pending(ask.itemId).length > 0;
      this.deps.writer.commit(answered(item, this.deps.ctx, ask.id, { behavior: answer.behavior }, others));
    }
  }

  /**
   * The user's Stop button: SIGTERM, SIGKILL after the grace period. A running item fails with
   * "stopped by you" so it can be started again; an item waiting on the user keeps its state.
   * Throws StopError(409) when no process is alive.
   */
  stop(itemId: string, graceMs = KILL_GRACE_MS): Promise<void> {
    const s = this.sessions.get(itemId);
    if (!s?.proc) throw new StopError("no agent is running for this item");
    if (!s.stoppedByUser) {
      s.stoppedByUser = true;
      s.proc.kill("SIGTERM");
      if (!s.done) {
        const timer = setTimeout(() => {
          if (!s.done) s.proc!.kill("SIGKILL");
        }, graceMs);
        timer.unref();
        void s.exited!.then(() => clearTimeout(timer));
      }
    }
    return s.exited!;
  }

  /** SIGTERM every agent, SIGKILL after the grace period (spec 9.5). Items keep their state. */
  async stopAll(graceMs = KILL_GRACE_MS): Promise<void> {
    const live = [...this.sessions.values()].filter((s) => s.proc);
    for (const s of live) {
      s.stopping = true;
      s.proc!.kill("SIGTERM");
    }
    const exited = Promise.all(live.map((s) => s.exited));
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), graceMs);
    });
    if (await Promise.race([exited.then(() => false), timedOut])) {
      for (const s of live) if (!s.done) s.proc!.kill("SIGKILL");
      await exited;
    }
    clearTimeout(timer);
  }

  private ingest(session: Session, line: string): void {
    const d = decodeLine(line);
    switch (d.type) {
      case "malformed":
        this.deps.log.warn({ itemId: session.itemId, line: line.slice(0, 200) }, "skipped malformed agent line");
        return;
      case "stream":
        this.deps.push("stream.delta", { itemId: session.itemId, event: d.event });
        return;
      case "init":
        this.onInit(session, d.sessionId, d.raw);
        return;
      case "message":
        this.store(session, d.kind, d.raw);
        this.track(session, d.kind, d.raw);
        return;
      case "ask":
        this.store(session, "raw", d.raw);
        this.onAsk(session, d.requestId, d.toolName, d.input);
        return;
      case "result":
        this.store(session, "result", d.raw);
        this.onResult(session, d);
        return;
    }
  }

  private onInit(session: Session, sessionId: string, raw: unknown): void {
    const first = session.sessionId === undefined && !session.turnClosed;
    const startedOwnTurn = session.turnClosed;
    session.sessionId = sessionId;
    session.turnClosed = false;
    this.store(session, "raw", raw);

    let item = this.item(session.itemId);
    // Persist the moment it arrives: it is what --resume needs after a crash.
    if (item.agentSessionId !== sessionId) item = this.deps.writer.save({ ...item, agentSessionId: sessionId });
    if (!first && startedOwnTurn && item.state === "needs_you" && this.deps.asks.pending(item.id).length === 0) {
      // A second init: the CLI started a turn on its own (spec 9.3).
      this.deps.writer.commit(turnStarted(item, this.deps.ctx));
    }
  }

  private onAsk(session: Session, requestId: string, toolName: string, input: unknown): void {
    const at = this.deps.ctx.now();
    const ask = { id: this.deps.ctx.newId(), itemId: session.itemId, requestId, toolName, input, state: "pending" as const };
    this.deps.asks.insert(ask, at);
    const item = this.item(session.itemId);
    if (item.state === "running" || item.state === "needs_you") {
      this.deps.writer.commit(agentAsked(item, this.deps.ctx, ask.id, { toolName }));
    }
  }

  private onResult(session: Session, d: { isError: boolean; subtype: string | undefined; raw: unknown }): void {
    session.turnClosed = true;
    const item = this.item(session.itemId);
    if (item.state !== "running" || this.deps.asks.pending(item.id).length > 0) return;
    const raw = d.raw as { total_cost_usd?: unknown };
    const payload: Record<string, unknown> = { subtype: d.subtype ?? null, isError: d.isError };
    if (typeof raw.total_cost_usd === "number") payload.costUsd = raw.total_cost_usd;
    this.deps.writer.commit(turnEnded(item, this.deps.ctx, payload));
  }

  private exited(session: Session, code: number | null, signal: NodeJS.Signals | null): void {
    session.done = true;
    this.sessions.delete(session.itemId);
    this.countChanged();
    this.deps.onActivity?.(session.itemId);
    this.deps.log.info({ itemId: session.itemId, code, signal }, "agent exited");
    // On shutdown the item stays as it is, to be resumed after the restart (spec 9.5).
    if (session.stopping) return;
    if (session.stoppedByUser) {
      const item = this.item(session.itemId);
      if (item.state === "running") this.deps.writer.commit(agentFailed(item, this.deps.ctx, "stopped by you"));
      return;
    }
    if (session.turnClosed && code === 0) return;

    const item = this.item(session.itemId);
    if (item.state !== "running" && item.state !== "needs_you") return;
    const reason =
      code === -1
        ? "claude could not be started"
        : signal
          ? `claude was killed by ${signal}`
          : `claude exited with code ${code} before finishing its turn`;
    this.deps.writer.commit(agentFailed(item, this.deps.ctx, reason, { stderrTail: session.stderr }));
    this.deps.log.warn({ itemId: item.id, code, signal }, reason);
  }

  /** Follow tool calls and their results for the "current tool" on the board. */
  private track(session: Session, kind: TranscriptKind, raw: unknown): void {
    if (kind !== "tool_use" && kind !== "tool_result") return;
    const blocks = (raw as { message?: { content?: unknown } }).message?.content;
    if (!Array.isArray(blocks)) return;
    let changed = false;
    for (const b of blocks as Array<Record<string, unknown>>) {
      if (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") {
        session.tools.set(b.id, { name: b.name, summary: toolSummary(b.name, b.input) });
        changed = true;
      } else if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
        changed = session.tools.delete(b.tool_use_id) || changed;
      }
    }
    if (changed) this.deps.onActivity?.(session.itemId);
  }

  private store(session: Session, kind: TranscriptKind, raw: unknown): void {
    const msg = {
      id: this.deps.ctx.newId(),
      itemId: session.itemId,
      sessionId: session.sessionId ?? "",
      at: this.deps.ctx.now(),
      kind,
      raw,
    };
    this.deps.transcript.append(msg);
    this.deps.push("transcript.appended", msg);
  }

  private item(id: string): WorkItem {
    const stored = this.deps.items.get(id);
    if (!stored) throw new Error(`item ${id} not found`);
    return stored.item;
  }

  private countChanged(): void {
    this.deps.onCountChanged?.(this.sessions.size);
  }
}

export class StopError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "StopError";
  }
}

export class AskError extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "AskError";
  }
}
