import { describe, expect, it } from "vitest";
import { toolSummary } from "./tool-summary.js";

describe("toolSummary", () => {
  it("shows the command of Bash, first line only", () => {
    expect(toolSummary("Bash", { command: "pnpm test\necho done", description: "Run tests" })).toBe("pnpm test");
  });

  it("shows the file of file tools", () => {
    expect(toolSummary("Edit", { file_path: "/w/src/a.ts", old_string: "a", new_string: "b" })).toBe("/w/src/a.ts");
    expect(toolSummary("Read", { file_path: "/w/README.md" })).toBe("/w/README.md");
  });

  it("shows the pattern of search tools", () => {
    expect(toolSummary("Grep", { pattern: "TODO", path: "src" })).toBe("TODO");
  });

  it("counts todos", () => {
    expect(toolSummary("TodoWrite", { todos: [{}, {}] })).toBe("2 todos");
  });

  it("falls back to the first string for unknown tools", () => {
    expect(toolSummary("mcp__donepm__draft_pr", { draft: 1, title: "Fix the bug" })).toBe("Fix the bug");
  });

  it("cuts long values", () => {
    const s = toolSummary("Bash", { command: "x".repeat(300) });
    expect(s).toHaveLength(120);
    expect(s.endsWith("…")).toBe(true);
  });

  it("is empty for odd input", () => {
    expect(toolSummary("Bash", null)).toBe("");
    expect(toolSummary("Foo", { n: 1 })).toBe("");
  });
});
