import { describe, expect, it } from "vitest";
import { fixture } from "../test-support/fake-exec.js";
import { parentToolUseId, questionsOf, taskEvent } from "@donepm/core";
import { decodeLine, type Decoded } from "./decode.js";

const lines = (name: string) => fixture(`stream/${name}`).split("\n").filter(Boolean);
const decodeAll = (name: string) => lines(name).map(decodeLine);
const summary = (d: Decoded) => (d.type === "message" ? `message:${d.kind}` : d.type);

describe("decodeLine against recorded sessions", () => {
  it("decodes a basic session: thinking, two tool calls, text, result", () => {
    const decoded = decodeAll("basic.jsonl");
    expect(decoded[0]).toMatchObject({ type: "message", kind: "raw" }); // hook_started comes first
    const init = decoded.find((d) => d.type === "init");
    expect(init).toMatchObject({ sessionId: expect.stringMatching(/^[0-9a-f-]{36}$/) });

    const kept = decoded.map(summary).filter((s) => s !== "stream" && s !== "message:raw");
    expect(kept).toEqual([
      "init",
      "message:assistant_thinking",
      "message:tool_use",
      "message:tool_result",
      "message:tool_use",
      "message:tool_result",
      "message:assistant_thinking",
      "message:assistant_text",
      "result",
    ]);
    expect(decoded.filter((d) => d.type === "stream")).toHaveLength(51);
    expect(decoded.at(-1)).toMatchObject({ type: "result", isError: false, subtype: "success" });
  });

  it("lifts a can_use_tool question out of the stream", () => {
    const ask = decodeAll("ask-allow.jsonl").find((d) => d.type === "ask");
    expect(ask).toMatchObject({
      type: "ask",
      requestId: expect.any(String),
      toolName: "Bash",
      input: { command: expect.stringContaining("curl -sI https://example.com") },
      rules: [{ toolName: "Bash", ruleContent: "curl *" }],
    });
  });

  it("keeps only add-allow-rule suggestions", () => {
    const d = decodeLine(JSON.stringify({
      type: "control_request", request_id: "r1",
      request: {
        subtype: "can_use_tool", tool_name: "Bash", input: {},
        permission_suggestions: [
          { type: "addRules", behavior: "allow", destination: "localSettings", rules: [{ toolName: "WebFetch", ruleContent: "domain:x.org" }] },
          { type: "addRules", behavior: "deny", rules: [{ toolName: "Bash", ruleContent: "rm *" }] },
          { type: "setMode", mode: "acceptEdits" },
          "junk",
        ],
      },
    }));
    expect(d).toMatchObject({ type: "ask", rules: [{ toolName: "WebFetch", ruleContent: "domain:x.org" }] });
  });

  it("has no rules when the CLI suggests none", () => {
    const d = decodeLine(JSON.stringify({ type: "control_request", request_id: "r1", request: { subtype: "can_use_tool", tool_name: "Bash", input: {} } }));
    expect(d).toMatchObject({ type: "ask", rules: [] });
    expect(d).not.toHaveProperty("reason");
  });

  it("carries the CLI's decision_reason", () => {
    const d = decodeLine(JSON.stringify({
      type: "control_request", request_id: "r1",
      request: { subtype: "can_use_tool", tool_name: "Bash", input: {}, decision_reason: "This command requires approval" },
    }));
    expect(d).toMatchObject({ type: "ask", reason: "This command requires approval" });
  });

  it("keeps the denial a tool result after a deny answer", () => {
    const decoded = decodeAll("ask-deny.jsonl");
    expect(decoded.filter((d) => d.type === "ask")).toHaveLength(1);
    const results = decoded.filter((d) => d.type === "message" && d.kind === "tool_result");
    expect(results).toHaveLength(1);
    expect(JSON.stringify(results[0])).toContain("Not allowed in this test.");
  });

  it("never fails on any recorded line", () => {
    for (const name of ["basic.jsonl", "ask-allow.jsonl", "ask-deny.jsonl", "deny-gh.jsonl", "subagent.jsonl", "ask-question.jsonl"]) {
      for (const d of decodeAll(name)) expect(d.type).not.toBe("malformed");
    }
  });
});

describe("a session with a subagent", () => {
  const AGENT = "toolu_01SBL4PYXe8HB6joVkWLMHdi";
  const raws = () => lines("subagent.jsonl").map((l) => JSON.parse(l) as unknown);

  it("stores the subagent's messages as ordinary messages that point at the Agent call", () => {
    const decoded = decodeAll("subagent.jsonl");
    const children = decoded.filter((d) => d.type === "message" && parentToolUseId(d.raw) === AGENT).map(summary);
    expect(new Set(children)).toEqual(new Set(["message:user", "message:tool_use", "message:tool_result", "message:raw"]));
    expect(children.filter((s) => s === "message:tool_use")).toHaveLength(13);
    expect(children.filter((s) => s === "message:tool_result")).toHaveLength(13);
    // The Agent call and its result belong to the main agent.
    const call = decoded.find((d) => d.type === "message" && d.kind === "tool_use" && JSON.stringify(d.raw).includes(`"id":"${AGENT}"`));
    expect(parentToolUseId(call?.type === "message" ? call.raw : undefined)).toBeUndefined();
  });

  it("keeps task lines raw and decodes their lifecycle", () => {
    const events = raws().map(taskEvent).filter((e) => e !== undefined);
    expect(events[0]).toMatchObject({ type: "started", toolUseId: AGENT, description: "Bump GitHub Actions to Node 24", background: false });
    expect(events.filter((e) => e.type === "progress")).toHaveLength(13);
    expect(events.at(-2)).toMatchObject({ type: "updated", status: "completed" });
    expect(events.at(-1)).toMatchObject({ type: "notification", toolUseId: AGENT, status: "completed" });
    for (const d of decodeAll("subagent.jsonl")) {
      if (d.type === "message" && taskEvent(d.raw)) expect(d.kind).toBe("raw");
    }
  });

  it("lifts the subagent's asks like the main agent's", () => {
    const asks = decodeAll("subagent.jsonl").filter((d) => d.type === "ask");
    expect(asks.map((a) => (a.type === "ask" ? a.toolName : ""))).toEqual([
      "WebFetch", "WebFetch", "WebFetch", "WebFetch", "Bash", "SandboxNetworkAccess", "Bash", "SandboxNetworkAccess",
    ]);
  });
});

describe("a session with AskUserQuestion", () => {
  it("lifts the question as an ask and keeps the answer the CLI hands back", () => {
    const decoded = decodeAll("ask-question.jsonl");
    const asks = decoded.filter((d) => d.type === "ask");
    expect(asks).toHaveLength(1);
    const ask = asks[0]!;
    if (ask.type !== "ask") throw new Error("not an ask");
    expect(ask.toolName).toBe("AskUserQuestion");
    expect(questionsOf(ask.input).map((q) => [q.header, q.multiSelect, q.options.length])).toEqual([
      ["Color", false, 3],
      ["Sizes", true, 3],
    ]);

    const result = decoded.find((d) => d.type === "message" && d.kind === "tool_result");
    expect(JSON.stringify(result)).toContain('Your questions have been answered: \\"Which color do you prefer?\\"=\\"Green\\"');
    expect(decoded.at(-1)).toMatchObject({ type: "result", isError: false });
  });
});

describe("decodeLine edge cases", () => {
  it("keeps unknown types and subtypes as raw", () => {
    expect(decodeLine('{"type":"brand_new","session_id":"s"}')).toEqual({
      type: "message", kind: "raw", sessionId: "s", raw: { type: "brand_new", session_id: "s" },
    });
    expect(decodeLine('{"type":"system","subtype":"thinking_tokens"}')).toMatchObject({ type: "message", kind: "raw" });
    expect(decodeLine('{"type":"assistant","message":{"content":[{"type":"server_tool_use"}]}}')).toMatchObject({ kind: "raw" });
  });

  it("keeps control requests other than can_use_tool raw", () => {
    expect(decodeLine('{"type":"control_request","request_id":"r","request":{"subtype":"hook_callback"}}')).toMatchObject({
      type: "message", kind: "raw",
    });
  });

  it("marks broken lines malformed instead of throwing", () => {
    expect(decodeLine('{"type":"assistant","mess')).toEqual({ type: "malformed", line: '{"type":"assistant","mess' });
    expect(decodeLine("[1,2]")).toMatchObject({ type: "malformed" });
    expect(decodeLine("")).toMatchObject({ type: "malformed" });
  });

  it("treats an init without session id as raw", () => {
    expect(decodeLine('{"type":"system","subtype":"init"}')).toMatchObject({ type: "message", kind: "raw" });
  });

  it("decodes user text messages and string content", () => {
    expect(decodeLine('{"type":"user","message":{"role":"user","content":"hi"}}')).toMatchObject({ kind: "user" });
    expect(decodeLine('{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}')).toMatchObject({ kind: "user" });
  });

  it("reads error results", () => {
    expect(decodeLine('{"type":"result","subtype":"error_during_execution","is_error":true}')).toMatchObject({
      type: "result", isError: true, subtype: "error_during_execution",
    });
  });
});
