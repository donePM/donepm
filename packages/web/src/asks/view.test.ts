import { describe, expect, it } from "vitest";
import { askCopyText, askReason, askView, tildePath } from "./view";

describe("askView", () => {
  const long = `${"x".repeat(300)}\nsecond line\n  third`;

  it("shows a Bash command whole, with its description and a cwd outside the worktree", () => {
    const view = askView("Bash", { command: long, description: "Build it", cwd: "/Users/rok/tmp" }, "/Users/rok/wt");
    expect(view).toEqual({ kind: "command", command: long, description: "Build it", cwd: "~/tmp" });
    expect(askCopyText(view)).toBe(long);
  });

  it("leaves out a cwd that is the worktree", () => {
    expect(askView("Bash", { command: "ls", cwd: "/w" }, "/w")).toEqual({ kind: "command", command: "ls" });
  });

  it("shows the path and the change for editing tools", () => {
    expect(askView("Edit", { file_path: "/home/me/a.ts", old_string: "a", new_string: "b" })).toEqual({
      kind: "edit", path: "~/a.ts", diff: [{ op: "-", text: "a" }, { op: "+", text: "b" }],
    });
    expect(askView("Write", { file_path: "/x/b.md", content: "hi\n" })).toMatchObject({ kind: "edit", diff: [{ op: "+", text: "hi" }] });
  });

  it("shows the URL or host on its own", () => {
    expect(askView("WebFetch", { url: "https://example.org/a", prompt: "read" })).toEqual({ kind: "target", target: "https://example.org/a" });
    expect(askView("SandboxNetworkAccess", { host: "registry.npmjs.org" })).toEqual({ kind: "target", target: "registry.npmjs.org" });
  });

  it("pretty-prints MCP and unknown tools", () => {
    const view = askView("mcp__x__do", { a: 1, b: ["c"] });
    expect(view).toEqual({ kind: "json", text: '{\n  "a": 1,\n  "b": [\n    "c"\n  ]\n}' });
    expect(askView("Bash", { command: "" })).toMatchObject({ kind: "json" });
  });

  it("draws from the ask's subject, whatever the agent called its tool (#136)", () => {
    expect(askView("exec", { argv: ["make"] }, "/w", { kind: "command", command: "make", cwd: "/w" })).toEqual({ kind: "command", command: "make" });
    expect(askView("connect", { to: "x" }, undefined, { kind: "network", host: "registry.npmjs.org" })).toEqual({ kind: "target", target: "registry.npmjs.org" });
    const patch = "--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,2 @@\n keep\n-old\n+new\n";
    expect(askView("apply_patch", { patch }, undefined, { kind: "file_change", path: "/home/me/a.ts", diff: patch })).toEqual({
      kind: "edit", path: "~/a.ts", diff: [{ op: " ", text: "keep" }, { op: "-", text: "old" }, { op: "+", text: "new" }],
    });
    expect(askView("odd", { a: 1 }, undefined, { kind: "tool", name: "odd", input: { a: 1 } })).toMatchObject({ kind: "json" });
  });
});

describe("tildePath", () => {
  it("shortens home directories only", () => {
    expect(tildePath("/Users/rok/x")).toBe("~/x");
    expect(tildePath("/home/rok")).toBe("~");
    expect(tildePath("/opt/Users/rok")).toBe("/opt/Users/rok");
  });
});

describe("askReason", () => {
  it("strips ANSI and blank reasons", () => {
    expect(askReason("\u001b[1mThis command requires approval\u001b[22m ")).toBe("This command requires approval");
    expect(askReason(" ")).toBeUndefined();
    expect(askReason(undefined)).toBeUndefined();
  });
});
