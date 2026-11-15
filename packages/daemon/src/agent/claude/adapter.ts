import { AGENT_CAPABILITIES, answeredInput, claudeAskSubject, toolSummary, webFetchHost, type AgentEvent } from "@donepm/core";
import type { AdapterLaunch, AgentAdapter, AgentConnection, AgentStep, AgentWrite, AskRef, AskReply } from "../adapter.js";
import { askAnswerLine, claudeArgv, userTurnLine } from "./argv.js";
import { decodeLine, type Decoded } from "./decode.js";
import { writeMcpConfig } from "./mcp-config.js";
import { usageFromResult } from "./usage.js";

/** Claude Code over stream-json (spec 9, Bloom PROTOCOL.md): the first adapter (issue #136). */
export const claudeCode: AgentAdapter = {
  kind: "claude-code",
  command: "claude",
  capabilities: AGENT_CAPABILITIES["claude-code"],

  launch(input: AdapterLaunch) {
    const file = input.mcp
      ? writeMcpConfig({ dir: input.mcp.dir, itemId: input.itemId, command: input.mcp.command, args: input.mcp.args, env: input.mcp.env })
      : undefined;
    const args = claudeArgv({
      playbook: input.playbook,
      ...(file ? { mcpConfigPath: file.path } : {}),
      ...(input.resumeSessionId ? { resumeSessionId: input.resumeSessionId } : {}),
      ...(input.home ? { home: input.home } : {}),
    });
    return { args, ...(file ? { cleanup: file.remove } : {}) };
  },

  connect(): AgentConnection {
    return {
      decode: (line) => claudeEvents(decodeLine(line)),
      firstTurn: userTurn,
      nextTurn: userTurn,
      answerAsk,
    };
  },
};

function userTurn(text: string): AgentStep[] {
  return [write(userTurnLine(text), "user")];
}

function answerAsk(ask: AskRef, reply: AskReply): AgentStep[] {
  if (reply.behavior === "deny") {
    return [write(askAnswerLine(ask.requestId, { behavior: "deny", message: reply.message, ...(reply.interrupt !== undefined ? { interrupt: reply.interrupt } : {}) }), "raw")];
  }
  // AskUserQuestion: Allow alone tells the agent "the user did not answer". Answers go in the input.
  const input = reply.answers ? answeredInput(ask.input, reply.answers) : ask.input;
  return [write(askAnswerLine(ask.requestId, { behavior: "allow", input, ...(reply.rules ? { rules: reply.rules } : {}) }), "raw")];
}

function write(line: string, kind: "user" | "raw"): AgentWrite {
  return { type: "write", line, record: { kind, raw: JSON.parse(line) as unknown } };
}

/** One decoded stream-json line as the runner's events. */
export function claudeEvents(d: Decoded): AgentEvent[] {
  switch (d.type) {
    case "malformed":
      return [d];
    case "stream":
      return [{ type: "live", event: d.event }];
    case "init":
      // Every turn starts with an init; the first binds the session.
      return [{ type: "session_bound", sessionId: d.sessionId }, { type: "raw", raw: d.raw }, { type: "turn_started" }];
    case "message":
      if (d.kind === "raw") return [{ type: "raw", raw: d.raw }];
      return [{ type: "message", kind: d.kind, raw: d.raw }, ...(d.kind === "tool_use" || d.kind === "tool_result" ? toolEvents(d.raw) : [])];
    case "ask": {
      const fetchHost = d.toolName === "WebFetch" ? webFetchHost(d.input) : undefined;
      return [
        { type: "raw", raw: d.raw },
        {
          type: "ask",
          ask: {
            requestId: d.requestId, toolName: d.toolName, input: d.input, subject: claudeAskSubject(d.toolName, d.input),
            rules: { offered: d.rules, suggested: d.suggested, flags: d.flags },
            ...(d.reason ? { reason: d.reason } : {}),
            ...(fetchHost ? { fetchHost } : {}),
          },
        },
      ];
    }
    case "result": {
      const raw = d.raw as { total_cost_usd?: unknown; usage?: unknown };
      const usage = usageFromResult(raw.usage);
      return [
        { type: "message", kind: "result", raw: d.raw },
        { type: "usage", ...(usage ? { usage } : {}), ...(typeof raw.total_cost_usd === "number" ? { costUsd: raw.total_cost_usd } : {}) },
        { type: "turn_ended", isError: d.isError, interrupted: false, ...(d.subtype !== undefined ? { detail: d.subtype } : {}) },
      ];
    }
  }
}

/** Tool calls and their results in an assistant or user line, for the board's "current tool". */
function toolEvents(raw: unknown): AgentEvent[] {
  const blocks = (raw as { message?: { content?: unknown } }).message?.content;
  if (!Array.isArray(blocks)) return [];
  return (blocks as Array<Record<string, unknown>>).flatMap((b): AgentEvent[] => {
    if (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") {
      return [{ type: "tool_started", id: b.id, name: b.name, summary: toolSummary(b.name, b.input) }];
    }
    if (b.type === "tool_result" && typeof b.tool_use_id === "string") return [{ type: "tool_finished", id: b.tool_use_id }];
    return [];
  });
}
