import { describe, expect, it } from "vitest";
import { codexAnswers, codexAskSubject, codexAsksSecret, codexQuestions, codexRequestId } from "./ask.js";

describe("codex asks", () => {
  it("makes request ids unique across processes", () => {
    expect(codexRequestId({ itemId: "call_1", turnId: "t1" }, 0)).toBe("call_1:0");
    expect(codexRequestId({ turnId: "t1" }, 3)).toBe("t1:3");
    expect(codexRequestId({}, 3)).toBe("-:3");
  });

  it("names a command, or the host of a network ask", () => {
    expect(codexAskSubject("item/commandExecution/requestApproval", { command: "/bin/zsh -lc 'pnpm i'", cwd: "/w" })).toEqual({
      kind: "command", command: "pnpm i", cwd: "/w",
    });
    expect(codexAskSubject("item/commandExecution/requestApproval", { command: "curl x", networkApprovalContext: { host: "registry.npmjs.org", protocol: "https" } })).toEqual({
      kind: "network", host: "registry.npmjs.org",
    });
    // The command may be only on the item.
    expect(codexAskSubject("item/commandExecution/requestApproval", {}, { command: "ls" })).toEqual({ kind: "command", command: "ls" });
  });

  it("takes a file change's diff from its item", () => {
    const item = { type: "fileChange", changes: [{ path: "/w/note.txt", kind: { type: "add" }, diff: "hi\n" }] };
    expect(codexAskSubject("item/fileChange/requestApproval", { itemId: "x" }, item, "/w")).toEqual({
      kind: "file_change", path: "/w/note.txt", diff: "--- /dev/null\n+++ b/note.txt\n@@ -0,0 +1,1 @@\n+hi",
    });
  });

  it("asks the user Codex's questions and answers them by id", () => {
    const params = {
      questions: [
        { id: "q1", header: "Lib", question: "Which library?", isOther: true, isSecret: false, options: [{ label: "a", description: "A" }] },
        { id: "q2", header: "", question: "Why?", isOther: false, isSecret: false, options: null },
      ],
    };
    expect(codexQuestions(params)).toEqual([
      { question: "Which library?", header: "Lib", multiSelect: false, options: [{ label: "a", description: "A" }] },
      { question: "Why?", header: "", multiSelect: false, options: [] },
    ]);
    expect(codexAskSubject("item/tool/requestUserInput", params).kind).toBe("question");
    expect(codexAnswers(params, { "Which library?": "a", "Why?": "speed" })).toEqual({ answers: { q1: { answers: ["a"] }, q2: { answers: ["speed"] } } });
    expect(codexAsksSecret(params)).toBe(false);
    expect(codexAsksSecret({ questions: [{ id: "k", question: "API key?", isSecret: true }] })).toBe(true);
  });

  it("shows an MCP elicitation as a tool ask, anything else as it came", () => {
    expect(codexAskSubject("mcpServer/elicitation/request", { serverName: "docs", mode: "form", message: "Allow?" })).toEqual({
      kind: "tool", name: "mcp:docs", input: { message: "Allow?" },
    });
    expect(codexAskSubject("something/new", { a: 1 })).toEqual({ kind: "tool", name: "something/new", input: { a: 1 } });
  });
});
