import { describe, expect, it } from "vitest";
import { fixture } from "../test-support/fake-exec.js";
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
    });
  });

  it("keeps the denial a tool result after a deny answer", () => {
    const decoded = decodeAll("ask-deny.jsonl");
    expect(decoded.filter((d) => d.type === "ask")).toHaveLength(1);
    const results = decoded.filter((d) => d.type === "message" && d.kind === "tool_result");
    expect(results).toHaveLength(1);
    expect(JSON.stringify(results[0])).toContain("Not allowed in this test.");
  });

  it("never fails on any recorded line", () => {
    for (const name of ["basic.jsonl", "ask-allow.jsonl", "ask-deny.jsonl", "deny-gh.jsonl"]) {
      for (const d of decodeAll(name)) expect(d.type).not.toBe("malformed");
    }
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
