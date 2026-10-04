import { describe, expect, it } from "vitest";
import { errorLine, notificationLine, parseFrame, requestLine, resultLine } from "./rpc.js";

describe("parseFrame", () => {
  it("tells responses, requests and notifications apart", () => {
    expect(parseFrame('{"id":3,"result":{"turn":{"id":"t"}}}')).toMatchObject({ type: "response", id: 3, result: { turn: { id: "t" } } });
    expect(parseFrame('{"id":3,"error":{"code":-32600,"message":"bad"}}')).toMatchObject({ type: "response", id: 3, error: { code: -32600, message: "bad" } });
    expect(parseFrame('{"method":"item/fileChange/requestApproval","id":0,"params":{"itemId":"x"}}')).toMatchObject({ type: "request", id: 0, method: "item/fileChange/requestApproval" });
    expect(parseFrame('{"method":"turn/started","params":{},"emittedAtMs":1}')).toMatchObject({ type: "notification", method: "turn/started" });
  });

  it("keeps what it does not know, and never throws", () => {
    expect(parseFrame('{"hello":1}')).toEqual({ type: "unknown", raw: { hello: 1 } });
    expect(parseFrame("null")).toEqual({ type: "unknown", raw: null });
    expect(parseFrame("{nope")).toEqual({ type: "malformed", line: "{nope" });
    expect(parseFrame('{"id":1,"error":"text"}')).toMatchObject({ type: "response", error: { message: '"text"' } });
  });
});

describe("lines", () => {
  it("writes frames without the jsonrpc member", () => {
    expect(JSON.parse(requestLine(1, "initialize", { a: 1 }))).toEqual({ id: 1, method: "initialize", params: { a: 1 } });
    expect(JSON.parse(notificationLine("initialized"))).toEqual({ method: "initialized" });
    expect(JSON.parse(resultLine(0, { decision: "accept" }))).toEqual({ id: 0, result: { decision: "accept" } });
    expect(JSON.parse(errorLine("x", -32601, "no"))).toEqual({ id: "x", error: { code: -32601, message: "no" } });
  });
});
