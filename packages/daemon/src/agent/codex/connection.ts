import {
  blockedCommand, CODEX_ASK_METHODS, CODEX_COMMAND_APPROVAL, CODEX_EFFORT_LEVELS, CODEX_ELICITATION, CODEX_FILE_APPROVAL, CODEX_USER_INPUT,
  codexAnswers, codexAskSubject, codexAsksSecret, codexItemKind, codexModel, codexPolicy, codexRequestId, codexToolName, codexToolSummary,
  isCodexToolItem, type AgentEvent, type CodexPolicy, type TokenUsage,
} from "@donepm/core";
import type { AdapterLaunch, AgentConnection, AgentStep, AgentWrite, AskRef, AskReply } from "../adapter.js";
import { errorLine, notificationLine, parseFrame, requestLine, resultLine, type Frame } from "./rpc.js";
import { codexTokens, subtractUsage } from "./usage.js";

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

/**
 * Notifications donePM never uses: per-character output of reasoning and commands. The agent's own
 * words (`item/agentMessage/delta`) still stream; everything else arrives whole on `item/completed`.
 */
export const OPTED_OUT_NOTIFICATIONS = [
  "item/reasoning/textDelta", "item/reasoning/summaryTextDelta", "item/reasoning/summaryPartAdded",
  "item/commandExecution/outputDelta", "item/fileChange/outputDelta",
];

const CLIENT_INFO = { name: "donepm", title: "donePM", version: "0" };

/** What donePM said when a request of its own comes back. */
type Sent =
  | { method: "initialize" | "thread/start" | "thread/resume" | "turn/interrupt" }
  | { method: "turn/start"; texts: string[] }
  /** `fallback`: the user's words, to start a turn with when the turn they were steered into is over. */
  | { method: "turn/steer"; text: string; fallback: boolean };

/** A question Codex holds its turn for, until donePM answers it. */
interface OpenAsk {
  id: number | string;
  method: string;
  params: unknown;
}

/**
 * One `codex app-server` process (issue #137). Holds what the protocol leaves to the client: the
 * request ids, the thread and its current turn, the open questions, and the items a question refers
 * to. Every frame it does not know becomes a `raw` row.
 */
export class CodexConnection implements AgentConnection {
  private nextId = 1;
  private readonly sent = new Map<number, Sent>();
  private threadId: string | undefined;
  private turnId: string | undefined;
  /** A `turn/start` is on its way; its turn has no id yet. */
  private starting = false;
  /** The user's words that wait for the thread, or for a turn to end. */
  private queue: string[] = [];
  private readonly ownTurns = new Set<string>();
  /** The thread's usage before this process: what a resumed thread reports first (Bloom fixture). */
  private baseline: TokenUsage | undefined;
  private usage: TokenUsage | undefined;
  private readonly asks = new Map<string, OpenAsk>();
  /** Items a question may refer to (a file change's diff is on its item), until they complete. */
  private readonly items = new Map<string, unknown>();
  private readonly policy: CodexPolicy;
  private readonly model: string | undefined;
  private readonly effort: string | undefined;

  constructor(private readonly launch: AdapterLaunch) {
    this.policy = codexPolicy(launch.playbook);
    this.model = codexModel(launch.playbook.model);
    const effort = launch.playbook.effort;
    this.effort = effort && (CODEX_EFFORT_LEVELS as readonly string[]).includes(effort) ? effort : undefined;
  }

  firstTurn(text: string): AgentStep[] {
    this.queue.push(text);
    return [this.request("initialize", { clientInfo: CLIENT_INFO, capabilities: { experimentalApi: true, requestAttestation: false, optOutNotificationMethods: OPTED_OUT_NOTIFICATIONS } }, { method: "initialize" })];
  }

  nextTurn(text: string): AgentStep[] {
    if (this.threadId && this.turnId) return [this.steer(this.turnId, text, true)];
    this.queue.push(text);
    return this.flush();
  }

  answerAsk(ask: AskRef, reply: AskReply): AgentStep[] {
    const open = this.asks.get(ask.requestId);
    if (!open) return [];
    this.asks.delete(ask.requestId);
    const allow = reply.behavior === "allow";
    const cancel = reply.behavior === "deny" && reply.interrupt === true;
    switch (open.method) {
      case CODEX_COMMAND_APPROVAL:
      case CODEX_FILE_APPROVAL: {
        const decision = allow ? (reply.forRun ? "acceptForSession" : "accept") : cancel ? "cancel" : "decline";
        // The approval takes a word only: the reason follows as a steer, or Codex tries the same again.
        return [this.answer(open.id, { decision }), ...(reply.behavior === "deny" && !cancel ? this.reason(reply.message) : [])];
      }
      case CODEX_USER_INPUT:
        return [
          this.answer(open.id, allow && reply.answers ? codexAnswers(open.params, reply.answers) : { answers: {} }),
          ...(cancel ? this.interrupt() : []),
        ];
      case CODEX_ELICITATION:
        return [this.answer(open.id, allow ? { action: "accept", content: {}, _meta: null } : { action: cancel ? "cancel" : "decline", content: null, _meta: null })];
      default:
        return [];
    }
  }

  interrupt(): AgentStep[] {
    if (!this.threadId || !this.turnId) return [];
    return [this.request("turn/interrupt", { threadId: this.threadId, turnId: this.turnId }, { method: "turn/interrupt" })];
  }

  decode(line: string): AgentStep[] {
    const frame = parseFrame(line);
    switch (frame.type) {
      case "malformed":
        return [frame];
      case "unknown":
        return [{ type: "raw", raw: frame.raw }];
      case "response":
        return this.onResponse(frame);
      case "request":
        return this.onRequest(frame);
      case "notification":
        return this.onNotification(frame);
    }
  }

  private onResponse(frame: Extract<Frame, { type: "response" }>): AgentStep[] {
    const raw: AgentStep = { type: "raw", raw: frame.raw };
    const sent = typeof frame.id === "number" ? this.sent.get(frame.id) : undefined;
    if (!sent) return [raw];
    this.sent.delete(frame.id as number);
    if (frame.error) return [raw, ...this.failed(sent, frame.error.message)];
    const result = isObject(frame.result) ? frame.result : {};
    switch (sent.method) {
      case "initialize":
        return [raw, this.notify("initialized"), this.openThread()];
      case "thread/start":
      case "thread/resume": {
        const id = isObject(result.thread) ? str(result.thread.id) : undefined;
        if (!id) return [raw, this.ended(true, `${sent.method} answered without a thread`)];
        this.threadId = id;
        return [raw, { type: "session_bound", sessionId: id }, ...this.flush()];
      }
      case "turn/start": {
        this.starting = false;
        const id = isObject(result.turn) ? str(result.turn.id) : undefined;
        if (id) this.begin(id);
        return [raw, ...(id ? this.steerQueued(id) : [])];
      }
      default:
        return [raw];
    }
  }

  /** A request of donePM's failed. One that a turn waits on ends the turn, so the item never hangs. */
  private failed(sent: Sent, message: string): AgentStep[] {
    switch (sent.method) {
      case "initialize":
      case "thread/start":
      case "thread/resume":
        return [this.ended(true, `${sent.method} failed: ${message}`)];
      case "turn/start":
        this.starting = false;
        return [this.ended(true, `turn/start failed: ${message}`)];
      case "turn/steer":
        // The turn ended in the meantime: the user's words start the next one. A refusal's reason
        // has nowhere to go once the turn is over, and the refusal itself has landed.
        if (!sent.fallback) return [];
        this.queue.push(sent.text);
        return this.flush();
      default:
        return [];
    }
  }

  private onRequest(frame: Extract<Frame, { type: "request" }>): AgentStep[] {
    const raw: AgentStep = { type: "raw", raw: frame.raw };
    const { id, method, params } = frame;
    if (method === "item/permissions/requestApproval") {
      // A wider sandbox for the rest of the turn: never granted. An empty profile grants nothing.
      return [raw, this.answer(id, { permissions: {}, scope: "turn" })];
    }
    if (!CODEX_ASK_METHODS.includes(method)) {
      return [raw, this.write(errorLine(id, -32601, `donePM does not handle ${method}`))];
    }
    const p = isObject(params) ? params : {};
    const itemId = str(p.itemId);
    const subject = codexAskSubject(method, params, itemId ? this.items.get(itemId) : undefined, this.launch.cwd);
    if (method === CODEX_COMMAND_APPROVAL && subject.kind === "command") {
      const blocked = blockedCommand(subject.command);
      if (blocked) {
        return [raw, this.answer(id, { decision: "decline" }), ...this.reason(
          `donePM does not let the agent run \`${blocked}\`. Anything that leaves this machine goes through donePM's draft tools (mcp donepm), for the user to approve.`,
        )];
      }
    }
    if (method === CODEX_USER_INPUT && codexAsksSecret(params)) {
      return [raw, this.answer(id, { answers: {} }), ...this.reason("donePM does not pass secrets to the agent. Carry on without it, or say what is missing.")];
    }
    const requestId = codexRequestId(params, id);
    this.asks.set(requestId, { id, method, params });
    const reason = str(p.reason);
    return [raw, { type: "ask", ask: { requestId, toolName: method, input: params, subject, ...(reason ? { reason } : {}) } }];
  }

  private onNotification(frame: Extract<Frame, { type: "notification" }>): AgentStep[] {
    const raw: AgentStep = { type: "raw", raw: frame.raw };
    const p = isObject(frame.params) ? frame.params : {};
    switch (frame.method) {
      case "item/agentMessage/delta":
        return [{ type: "live", event: frame.raw }];
      case "item/started":
      case "item/completed":
        return this.onItem(frame, p.item);
      case "turn/started": {
        const id = isObject(p.turn) ? str(p.turn.id) : undefined;
        if (id) this.begin(id);
        return [raw, { type: "turn_started" }];
      }
      case "turn/completed":
        return [raw, ...this.onTurnCompleted(p.turn)];
      case "thread/tokenUsage/updated":
        this.onUsage(str(p.turnId), isObject(p.tokenUsage) ? p.tokenUsage.total : undefined);
        return [raw];
      default:
        // Deltas are typing; the item that follows carries the same text whole.
        return frame.method.endsWith("Delta") || frame.method.endsWith("/delta") ? [] : [raw];
    }
  }

  private onItem(frame: Extract<Frame, { type: "notification" }>, item: unknown): AgentStep[] {
    const id = isObject(item) ? str(item.id) : undefined;
    const kind = codexItemKind(item);
    if (!id || kind === "raw") return [{ type: "raw", raw: frame.raw }];
    const steps: AgentEvent[] = [{ type: "message", kind, raw: frame.raw, refId: id }];
    if (frame.method === "item/started") {
      if (isObject(item) && (item.type === "fileChange" || item.type === "commandExecution")) this.items.set(id, item);
      if (isCodexToolItem(item)) steps.push({ type: "tool_started", id, name: codexToolName(item), summary: codexToolSummary(item, this.launch.cwd) });
    } else {
      this.items.delete(id);
      if (isCodexToolItem(item)) steps.push({ type: "tool_finished", id });
    }
    return steps;
  }

  private onTurnCompleted(turn: unknown): AgentStep[] {
    const t = isObject(turn) ? turn : {};
    const id = str(t.id);
    if (id && id !== this.turnId && !this.ownTurns.has(id)) return [];
    this.turnId = undefined;
    this.items.clear();
    const status = str(t.status) ?? "completed";
    const error = isObject(t.error) ? str(t.error.message) : undefined;
    return [
      { type: "usage", ...(this.usage ? { usage: this.usage } : {}) },
      { type: "turn_ended", isError: status === "failed", interrupted: status === "interrupted", detail: error ?? status },
      ...this.flush(),
    ];
  }

  /**
   * Usage of the process so far. Codex reports the thread's total; a resumed thread first reports
   * what it had used before, for a turn of an earlier process, and that is subtracted.
   */
  private onUsage(turnId: string | undefined, total: unknown): void {
    const usage = codexTokens(total);
    if (!usage) return;
    if (turnId && this.ownTurns.has(turnId)) {
      this.usage = this.baseline ? subtractUsage(usage, this.baseline) : usage;
    } else if (!this.baseline && !this.usage) {
      this.baseline = usage;
    }
  }

  private begin(turnId: string): void {
    this.turnId = turnId;
    this.ownTurns.add(turnId);
  }

  /** Send what waits: a new turn when none is running or starting. */
  private flush(): AgentStep[] {
    if (!this.threadId || this.turnId || this.starting || this.queue.length === 0) return [];
    const texts = this.queue;
    this.queue = [];
    this.starting = true;
    const params = {
      threadId: this.threadId,
      input: texts.map((text) => ({ type: "text", text, text_elements: [] })),
      cwd: this.launch.cwd,
      approvalPolicy: this.policy.approvalPolicy,
      approvalsReviewer: this.policy.approvalsReviewer,
      ...(this.model ? { model: this.model } : {}),
      ...(this.effort ? { effort: this.effort } : {}),
    };
    return [this.request("turn/start", params, { method: "turn/start", texts }, "user")];
  }

  /** Words that arrived while the turn was starting go into it once it has an id. */
  private steerQueued(turnId: string): AgentStep[] {
    const texts = this.queue;
    this.queue = [];
    return texts.map((text) => this.steer(turnId, text, true));
  }

  /** A refusal's reason, into the running turn; nothing when no turn runs. */
  private reason(message: string): AgentStep[] {
    return this.threadId && this.turnId && message ? [this.steer(this.turnId, message, false)] : [];
  }

  private steer(turnId: string, text: string, fallback: boolean): AgentWrite {
    const params = { threadId: this.threadId, input: [{ type: "text", text, text_elements: [] }], expectedTurnId: turnId };
    return this.request("turn/steer", params, { method: "turn/steer", text, fallback }, fallback ? "user" : "raw");
  }

  private openThread(): AgentWrite {
    // No `sandbox` here and no `sandboxPolicy` on turns: either replaces the permission profile set
    // on the command line (argv.ts), and with it the Keychain deny.
    const common = {
      cwd: this.launch.cwd,
      approvalPolicy: this.policy.approvalPolicy,
      approvalsReviewer: this.policy.approvalsReviewer,
      ...(this.model ? { model: this.model } : {}),
    };
    const resume = this.launch.resumeSessionId;
    return resume
      ? this.request("thread/resume", { threadId: resume, ...common }, { method: "thread/resume" })
      : this.request("thread/start", common, { method: "thread/start" });
  }

  private ended(isError: boolean, detail: string): AgentEvent {
    return { type: "turn_ended", isError, interrupted: false, detail };
  }

  private request(method: string, params: unknown, sent: Sent, kind: "user" | "raw" = "raw"): AgentWrite {
    const id = this.nextId++;
    this.sent.set(id, sent);
    return this.write(requestLine(id, method, params), kind);
  }

  private notify(method: string): AgentWrite {
    return this.write(notificationLine(method));
  }

  private answer(id: number | string, result: unknown): AgentWrite {
    return this.write(resultLine(id, result));
  }

  private write(line: string, kind: "user" | "raw" = "raw"): AgentWrite {
    return { type: "write", line, record: { kind, raw: JSON.parse(line) as unknown } };
  }
}
