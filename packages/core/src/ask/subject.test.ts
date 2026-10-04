import { describe, expect, it } from "vitest";
import { claudeAskSubject } from "./subject.js";

describe("claudeAskSubject", () => {
  it("reads a Bash command with its note and cwd", () => {
    expect(claudeAskSubject("Bash", { command: "pnpm test", description: "Run tests", cwd: "/wt" })).toEqual({
      kind: "command", command: "pnpm test", description: "Run tests", cwd: "/wt",
    });
    expect(claudeAskSubject("Bash", { command: "ls" })).toEqual({ kind: "command", command: "ls" });
  });

  it("reads file writes and edits", () => {
    for (const tool of ["Write", "Edit", "MultiEdit"]) {
      expect(claudeAskSubject(tool, { file_path: "/wt/a.ts" })).toEqual({ kind: "file_change", path: "/wt/a.ts" });
    }
  });

  it("reads WebFetch and the sandbox's network question as network access", () => {
    expect(claudeAskSubject("WebFetch", { url: "https://Docs.Example.com/x", prompt: "p" })).toEqual({
      kind: "network", host: "docs.example.com", url: "https://Docs.Example.com/x",
    });
    expect(claudeAskSubject("SandboxNetworkAccess", { host: "registry.npmjs.org" })).toEqual({ kind: "network", host: "registry.npmjs.org" });
  });

  it("reads AskUserQuestion as questions", () => {
    const input = { questions: [{ question: "Which?", header: "H", multiSelect: false, options: [{ label: "A", description: "" }] }] };
    expect(claudeAskSubject("AskUserQuestion", input)).toEqual({
      kind: "question", questions: [{ question: "Which?", header: "H", multiSelect: false, options: [{ label: "A", description: "" }] }],
    });
  });

  it("keeps anything else as the tool and its input", () => {
    expect(claudeAskSubject("mcp__x__y", { a: 1 })).toEqual({ kind: "tool", name: "mcp__x__y", input: { a: 1 } });
    expect(claudeAskSubject("Bash", {})).toEqual({ kind: "tool", name: "Bash", input: {} });
    expect(claudeAskSubject("Edit", "nonsense")).toEqual({ kind: "tool", name: "Edit", input: "nonsense" });
  });
});
