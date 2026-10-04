import { describe, expect, it } from "vitest";
import { codexDiff, codexItemKind, codexToolName, codexToolSummary, isCodexToolItem, unwrapShell } from "./items.js";

describe("codex items", () => {
  it("maps items to transcript kinds; unknown and user items stay raw", () => {
    expect(codexItemKind({ type: "agentMessage", text: "hi" })).toBe("assistant_text");
    expect(codexItemKind({ type: "reasoning" })).toBe("assistant_thinking");
    expect(codexItemKind({ type: "commandExecution" })).toBe("tool_use");
    expect(codexItemKind({ type: "fileChange" })).toBe("tool_use");
    expect(codexItemKind({ type: "userMessage" })).toBe("raw");
    expect(codexItemKind({ type: "somethingNew" })).toBe("raw");
    expect(codexItemKind(null)).toBe("raw");
    expect(isCodexToolItem({ type: "mcpToolCall" })).toBe(true);
    expect(isCodexToolItem({ type: "plan" })).toBe(false);
  });

  it("takes the command out of the shell wrapper", () => {
    expect(unwrapShell("/bin/zsh -lc 'ls -la'")).toBe("ls -la");
    expect(unwrapShell(`/bin/bash -lc "echo \\"hi\\""`)).toBe('echo "hi"');
    expect(unwrapShell("bash -c 'echo '\\''x'\\'''")).toBe("echo 'x'");
    expect(unwrapShell("ls -la")).toBe("ls -la");
  });

  it("names and summarises tool items", () => {
    const cmd = { type: "commandExecution", command: "/bin/zsh -lc 'pnpm test'", cwd: "/w" };
    expect(codexToolName(cmd)).toBe("Bash");
    expect(codexToolSummary(cmd)).toBe("pnpm test");
    const edit = { type: "fileChange", changes: [{ path: "/w/a.ts" }, { path: "/w/b.ts" }] };
    expect(codexToolName(edit)).toBe("Edit");
    expect(codexToolSummary(edit, "/w")).toBe("a.ts (+1 more)");
    expect(codexToolName({ type: "mcpToolCall", server: "donepm-draft-gate", tool: "draft_pr" })).toBe("mcp__donepm-draft-gate__draft_pr");
    expect(codexToolSummary({ type: "webSearch", query: "vitest" })).toBe("vitest");
  });

  it("makes one unified diff with headers", () => {
    const item = {
      changes: [
        { path: "/w/new.txt", kind: { type: "add" }, diff: "hi\nthere\n" },
        { path: "/w/a.ts", kind: { type: "update", move_path: null }, diff: "@@ -1 +1 @@\n-a\n+b\n" },
        { path: "/w/old.txt", kind: { type: "delete" }, diff: "bye\n" },
      ],
    };
    expect(codexDiff(item, "/w")).toBe(
      [
        "--- /dev/null", "+++ b/new.txt", "@@ -0,0 +1,2 @@", "+hi", "+there",
        "--- a/a.ts", "+++ b/a.ts", "@@ -1 +1 @@", "-a", "+b",
        "--- a/old.txt", "+++ /dev/null", "@@ -1,1 +0,0 @@", "-bye",
      ].join("\n"),
    );
  });
});
