import {
  agentAsked, agentFailed, agentOf, alwaysAllowed, answered, askDeniedBySystem, matchGrants, rawRule, repoName, type GrantRef, interrupted, checkAnswers, type Answers, autoAllowed, isRuleOfferable, matchingDomain, toolSummary, turnEnded, turnStarted,
  isStored, storedKind,
  type AgentAsk, type AgentKind, type Ctx, type PermissionAsk, type PermissionRule, type Playbook, type TokenUsage, type TranscriptKind, type WorkItem,
} from "@donepm/core";
import type { GrantStore } from "../asks/grants.js";
import type { AskStore } from "../asks/store.js";
import type { ItemStore } from "../items/store.js";
import type { ItemWriter } from "../items/commit.js";
import type { CurrentTool } from "../items/view.js";
import type { Log } from "../log.js";
import type { TranscriptStore } from "../transcript/store.js";
import type { PushType } from "../ws/hub.js";
import { adapterFor as builtInAdapter, type AgentAdapter, type AgentConnection, type AgentStep, type McpServer } from "./adapter.js";
import type { AgentProcess, ProcessFactory } from "./process.js";

export const STDERR_TAIL_LINES = 50;
export const KILL_GRACE_MS = 5_000;
export const DENY_ON_SHUTDOWN = "donePM is shutting down; the ask was not answered.";
export const DENY_ON_STOP = "The user stopped the agent; the ask was not answered.";

export interface RunnerDeps {
  items: ItemStore;
  writer: ItemWriter;
  asks: AskStore;
  transcript: TranscriptStore;
  push: (type: PushType, payload: unknown) => void;
  ctx: Ctx;
  log: Log;
  spawn: ProcessFactory;
  /** Detected path of an agent's program. Undefined: its name, looked up on `PATH`. */
  agentPath: (kind: AgentKind) => string | undefined;
  /** The adapter for a kind (issue #136). Absent: the built-in ones. */
  adapterFor?: (kind: AgentKind) => AgentAdapter;
  /** Environment for the agent: filtered `PATH`, no tokens. */
  env: () => Promise<NodeJS.ProcessEnv>;
  maxConcurrent: () => number;
  /** Reports the number of live sessions (status bar). */
  onCountChanged?: (running: number) => void;
  /** The current tool of an item changed; the board shows it. */
  onActivity?: (itemId: string) => void;
  /** Opens the draft gate for one process: donePM's MCP server for it; `close` revokes it. */
  mcp?: (item: WorkItem, playbook: Playbook) => { server: McpServer; close: () => void };
  /** Hosts whose WebFetch asks the daemon allows itself (D31). Absent or empty: every one asks. */
  webFetchDomains?: () => readonly string[];
  /** "Always allow" grants per repository (D38). Absent: every ask goes to the user. */
  grants?: GrantStore;
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
  adapter?: AgentAdapter;
  conn?: AgentConnection;
  sessionId?: string;
  /** The latest turn ended. Reset when the next one starts. */
  turnClosed: boolean;
  /** Usage the agent reported since the last turn ended; goes into `agent.turn_ended`. */
  usage?: { usage?: TokenUsage; costUsd?: number };
  stderr: string[];
  /** Shutdown of the daemon: the item keeps its state. */
  stopping: boolean;
  /** The user pressed Stop: the item fails with a reason it can be retried from. */
  stoppedByUser: boolean;
  done: boolean;
  /** Why asks are denied from now on: set when the process is being stopped. */
  closing?: string;
  /** The item was already marked interrupted for this stop. */
  interruptedNoted?: boolean;
  /** A read-only playbook (D42): the repository's "Always allow" grants do not apply. */
  readOnly?: boolean;
  /** Tool calls without a result yet, by the agent's id, in call order. */
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
 * Runs one agent process per item (spec 9), through the adapter of the item's agent kind (issue
 * #136). Reads stdout line by line, stores what it reads, and moves the item through the core
 * transitions. Never fails on an unknown line.
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

  /** An agent process is alive for the item (a reserved slot still preparing does not count). */
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
    const kind = agentOf(input.item);
    const adapter = (this.deps.adapterFor ?? builtInAdapter)(kind);
    const env = await this.deps.env();
    const mcp = this.deps.mcp?.(input.item, input.playbook);
    let launched: { args: string[]; cleanup?: () => void };
    try {
      launched = adapter.launch({
        itemId: input.item.id,
        playbook: input.playbook,
        ...(mcp ? { mcp: mcp.server } : {}),
        ...(input.resumeSessionId ? { resumeSessionId: input.resumeSessionId } : {}),
        ...(env.HOME ? { home: env.HOME } : {}),
      });
    } catch (e) {
      mcp?.close();
      throw e;
    }
    const proc = this.deps.spawn(this.deps.agentPath(kind) ?? adapter.command, launched.args, { cwd: input.cwd, env });
    session.proc = proc;
    session.adapter = adapter;
    session.conn = adapter.connect();
    session.readOnly = input.playbook.readOnly === true;
    if (input.resumeSessionId) session.sessionId = input.resumeSessionId;

    session.exited = new Promise((resolve) => {
      proc.onExit((code, signal) => {
        mcp?.close();
        launched.cleanup?.();
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

    this.run(session, session.conn.firstTurn(input.prompt));
  }

  /** Send the agent its next user message, e.g. the reason a draft was rejected. */
  say(itemId: string, text: string): void {
    const session = this.sessions.get(itemId);
    if (!session?.proc || !session.conn) throw new Error("the agent for this item is not running");
    this.run(session, session.conn.nextTurn(text));
  }

  /** Answer a pending permission question (spec 9.4). */
  answer(
    askId: string,
    answer: { behavior: "allow"; scope?: "run" | "always"; answers?: Answers } | { behavior: "deny"; message?: string; interrupt?: boolean },
  ): void {
    const ask = this.deps.asks.get(askId);
    if (!ask) throw new AskError(404, "ask not found");
    if (ask.state !== "pending") throw new AskError(409, `ask already ${ask.state}`);
    const session = this.sessions.get(ask.itemId);
    if (!session?.proc || !session.conn) throw new AskError(409, "the agent for this item is not running");

    // "For this run" without suggested rules is a plain allow. Stored rules passed the guard already;
    // check again because a blocked grant must never reach the agent.
    const granted = answer.behavior === "allow" && answer.scope === "run" ? ask.rules : [];
    if (!granted.every(isRuleOfferable)) throw new AskError(409, "this ask has a rule that may not be granted");
    // "Always allow" (D38) answers with a plain allow: the agent keeps asking, and the daemon answers
    // from the grants, so removing one in Settings applies to this run too.
    const always = answer.behavior === "allow" && answer.scope === "always";
    if (always) {
      if (!this.deps.grants || !session.adapter?.capabilities.alwaysAllow) throw new AskError(409, "always allow is not available");
      if (ask.rules.length === 0) throw new AskError(409, "this ask has no rule to always allow");
      if (!ask.rules.every(isRuleOfferable)) throw new AskError(409, "this ask has a rule that may not be granted");
    }

    // A question: Allow alone tells the agent "the user did not answer", so answers are required.
    let answers: Answers | undefined;
    if (answer.behavior === "allow") {
      if (ask.subject.kind === "question") {
        if (!answer.answers) throw new AskError(400, "answer the questions or decline");
        try {
          answers = checkAnswers(ask.subject.questions, answer.answers);
        } catch (err) {
          throw new AskError(400, (err as Error).message);
        }
      } else if (answer.answers) {
        throw new AskError(400, "only a question takes answers");
      }
    }

    const steps = session.conn.answerAsk(
      ask,
      answer.behavior === "allow"
        ? { behavior: "allow", ...(granted.length ? { rules: granted } : {}), ...(answers ? { answers } : {}) }
        : { behavior: "deny", message: answer.message || "The user denied this.", ...(answer.interrupt !== undefined ? { interrupt: answer.interrupt } : {}) },
    );
    const at = this.deps.ctx.now();
    this.writeAll(session, steps, false);
    this.deps.asks.setState(ask.id, answer.behavior === "allow" ? "allowed" : "denied", at);
    this.recordAll(session, steps);

    const grants = always ? this.grant(ask.itemId, ask.id, ask.rules, `${ask.toolName}: ${toolSummary(ask.toolName, ask.input)}`, at) : [];

    const item = this.item(ask.itemId);
    if (item.state === "needs_you") {
      const others = this.deps.asks.pending(ask.itemId).length > 0;
      if (always) {
        this.deps.writer.commit(alwaysAllowed(item, this.deps.ctx, ask.id, grants, others));
        return;
      }
      this.deps.writer.commit(answered(item, this.deps.ctx, ask.id, { behavior: answer.behavior, rules: granted, interrupt: answer.behavior === "deny" && answer.interrupt === true, ...(answers ? { answers } : {}) }, others));
    }
  }

  /** Store a grant per rule for the item's repository; rules it already has are skipped. */
  private grant(itemId: string, askId: string, rules: readonly PermissionRule[], call: string, at: string): GrantRef[] {
    const repo = this.repoOf(itemId);
    return rules.flatMap((rule) => {
      const g = this.deps.grants!.add({ id: this.deps.ctx.newId(), repo, rule, askId, itemId, call }, at);
      return g ? [{ id: g.id, repo: g.repo, toolName: g.toolName, ...(g.ruleContent !== undefined ? { ruleContent: g.ruleContent } : {}) }] : [];
    });
  }

  /** The normalised origin of the item's repository: grants belong to it, not to one clone. */
  private repoOf(itemId: string): string {
    const stored = this.deps.items.get(itemId);
    if (!stored) throw new Error(`item ${itemId} not found`);
    return stored.originUrl;
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
      s.closing = DENY_ON_STOP;
      this.denyPending(s, "stopped by you");
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
      s.closing = DENY_ON_SHUTDOWN;
      this.denyPending(s, "donePM is shutting down");
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

  /**
   * Answer every pending ask of the process with a deny before it is signalled, so the agent does not
   * wait on a question nobody can answer (spec 9.5). The item keeps its state; if it waited on those
   * asks it is interrupted, to be resumed.
   */
  private denyPending(session: Session, interruptReason: string): void {
    const message = session.closing;
    if (!message || !session.proc || !session.conn) return;
    const pending = this.deps.asks.pending(session.itemId);
    if (pending.length === 0) return;
    for (const ask of pending) {
      const steps = session.conn.answerAsk(ask, { behavior: "deny", message });
      this.writeAll(session, steps, false);
      this.deps.asks.setState(ask.id, "denied", this.deps.ctx.now(), message);
      this.recordAll(session, steps);
      const item = this.item(ask.itemId);
      if (item.state === "running" || item.state === "needs_you") {
        this.deps.writer.commit(askDeniedBySystem(item, this.deps.ctx, ask.id, message));
      }
    }
    const item = this.item(session.itemId);
    if (item.state === "needs_you" && !session.interruptedNoted) {
      session.interruptedNoted = true;
      this.deps.writer.commit(interrupted(item, this.deps.ctx, interruptReason));
    }
  }

  private ingest(session: Session, line: string): void {
    const steps = session.conn!.decode(line);
    if (steps.some((s) => s.type === "malformed")) {
      this.deps.log.warn({ itemId: session.itemId, line: line.slice(0, 200) }, "skipped malformed agent line");
    }
    this.run(session, steps);
  }

  /** Act on a connection's steps in order. The board hears of tool changes once per batch. */
  private run(session: Session, steps: readonly AgentStep[]): void {
    let toolsChanged = false;
    for (const step of steps) {
      if (step.type !== "write" && isStored(step)) {
        this.store(session, storedKind(step), step.raw);
        continue;
      }
      switch (step.type) {
        case "write":
          session.proc!.write(step.line);
          if (step.record) this.store(session, step.record.kind, step.record.raw);
          break;
        case "live":
          this.deps.push("stream.delta", { itemId: session.itemId, event: step.event });
          break;
        case "session_bound":
          this.onSessionBound(session, step.sessionId);
          break;
        case "turn_started":
          this.onTurnStarted(session);
          break;
        case "tool_started":
          session.tools.set(step.id, { name: step.name, summary: step.summary });
          toolsChanged = true;
          break;
        case "tool_finished":
          toolsChanged = session.tools.delete(step.id) || toolsChanged;
          break;
        case "ask":
          this.onAsk(session, step.ask);
          break;
        case "usage":
          session.usage = { ...session.usage, ...(step.usage ? { usage: step.usage } : {}), ...(step.costUsd !== undefined ? { costUsd: step.costUsd } : {}) };
          break;
        case "turn_ended":
          this.onTurnEnded(session, step);
          break;
        case "malformed":
          break;
      }
    }
    if (toolsChanged) this.deps.onActivity?.(session.itemId);
  }

  /** Write a connection's lines to the agent without recording them yet. */
  private writeAll(session: Session, steps: readonly AgentStep[], record: boolean): void {
    for (const step of steps) {
      if (step.type !== "write") continue;
      session.proc!.write(step.line);
      if (record && step.record) this.store(session, step.record.kind, step.record.raw);
    }
  }

  /** Record what `writeAll` wrote, once the ask's state is stored. */
  private recordAll(session: Session, steps: readonly AgentStep[]): void {
    for (const step of steps) if (step.type === "write" && step.record) this.store(session, step.record.kind, step.record.raw);
  }

  private onSessionBound(session: Session, sessionId: string): void {
    session.sessionId = sessionId;
    const item = this.item(session.itemId);
    // Persist the moment it arrives: it is what a resume needs after a crash.
    if (item.agentSessionId !== sessionId) this.deps.writer.save({ ...item, agentSessionId: sessionId });
  }

  private onTurnStarted(session: Session): void {
    const startedOwnTurn = session.turnClosed;
    session.turnClosed = false;
    const item = this.item(session.itemId);
    if (startedOwnTurn && !session.closing && item.state === "needs_you" && this.deps.asks.pending(item.id).length === 0) {
      // A new turn after the last one ended: the agent started it on its own (spec 9.3).
      this.deps.writer.commit(turnStarted(item, this.deps.ctx));
    }
  }

  private onAsk(session: Session, asked: AgentAsk): void {
    const at = this.deps.ctx.now();
    if (this.autoAllow(session, asked, at)) return;
    if (this.allowByGrant(session, asked, at)) return;
    const ask: PermissionAsk = { ...this.askRecord(session, asked), state: "pending", rules: asked.rules?.offered ?? [], ...(asked.reason ? { reason: asked.reason } : {}) };
    this.deps.asks.insert(ask, at);
    const item = this.item(session.itemId);
    if (item.state === "running" || item.state === "needs_you") {
      this.deps.writer.commit(agentAsked(item, this.deps.ctx, ask.id, { toolName: ask.toolName }));
    }
    // A question that arrives while the process is being stopped cannot be answered either.
    if (session.closing) this.denyPending(session, session.stoppedByUser ? "stopped by you" : "donePM is shutting down");
  }

  private askRecord(session: Session, asked: AgentAsk) {
    return {
      id: this.deps.ctx.newId(), itemId: session.itemId, agentKind: session.adapter!.kind,
      requestId: asked.requestId, toolName: asked.toolName, input: asked.input, subject: asked.subject,
    };
  }

  /**
   * A plain read of one URL on a host on the user's list is answered here and never reaches the
   * user (D31). Only such a read: the same host in a sandbox rule would also open it to commands (D27).
   */
  private autoAllow(session: Session, asked: AgentAsk, at: string): boolean {
    const host = asked.fetchHost;
    if (!host || !session.proc || !session.conn) return false;
    const domain = matchingDomain(host, this.deps.webFetchDomains?.() ?? []);
    if (!domain) return false;
    const item = this.item(session.itemId);
    if (item.state !== "running" && item.state !== "needs_you") return false;

    this.writeAll(session, session.conn.answerAsk(asked, { behavior: "allow" }), false);
    const ask: PermissionAsk = { ...this.askRecord(session, asked), state: "allowed", rules: [] };
    this.deps.asks.insert(ask, at);
    this.deps.writer.commit(autoAllowed(item, this.deps.ctx, ask.id, { toolName: ask.toolName, host, domain }));
    return true;
  }

  /**
   * An ask whose every suggested rule has an "Always allow" grant in the item's repository is
   * answered with a plain allow (D38). The grants are read on every ask, so a removal in Settings
   * applies to a running agent from its next ask on.
   */
  private allowByGrant(session: Session, asked: AgentAsk, at: string): boolean {
    // Grants were given for the user's own work; code under review asks every time (D42).
    if (!this.deps.grants || !asked.rules || !session.proc || !session.conn || session.closing || session.readOnly) return false;
    const repo = this.repoOf(session.itemId);
    const grants = matchGrants(asked.toolName, asked.rules.suggested, asked.rules.flags, this.deps.grants.active(repo));
    if (!grants) return false;
    const item = this.item(session.itemId);
    if (item.state !== "running" && item.state !== "needs_you") return false;

    this.writeAll(session, session.conn.answerAsk(asked, { behavior: "allow" }), true);
    const reason = `always allowed in ${repoName(repo)}: ${grants.map(rawRule).join(", ")}`;
    const ask: PermissionAsk = { ...this.askRecord(session, asked), state: "pending", rules: [] };
    this.deps.asks.insert(ask, at);
    this.deps.asks.setState(ask.id, "allowed", at, reason);
    this.deps.grants.used(grants.map((g) => g.id), at);
    this.deps.writer.commit(autoAllowed(item, this.deps.ctx, ask.id, {
      toolName: ask.toolName, repo, grants: grants.map((g) => ({ grantId: g.id, toolName: g.toolName, ...(g.ruleContent !== undefined ? { ruleContent: g.ruleContent } : {}) })),
    }));
    return true;
  }

  private onTurnEnded(session: Session, ended: { isError: boolean; detail?: string }): void {
    session.turnClosed = true;
    const usage = session.usage;
    session.usage = undefined;
    const item = this.item(session.itemId);
    if (item.state !== "running" || this.deps.asks.pending(item.id).length > 0) return;
    const payload: Record<string, unknown> = { subtype: ended.detail ?? null, isError: ended.isError };
    if (usage?.costUsd !== undefined) payload.costUsd = usage.costUsd;
    if (usage?.usage) payload.usage = usage.usage;
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
    const name = session.adapter?.command ?? "the agent";
    const reason =
      code === -1
        ? `${name} could not be started`
        : signal
          ? `${name} was killed by ${signal}`
          : `${name} exited with code ${code} before finishing its turn`;
    this.deps.writer.commit(agentFailed(item, this.deps.ctx, reason, { stderrTail: session.stderr }));
    this.deps.log.warn({ itemId: item.id, code, signal }, reason);
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
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "AskError";
  }
}
