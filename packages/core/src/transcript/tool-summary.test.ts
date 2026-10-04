import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bashSummary, relativePath, resultNote, stepSummary, testCounts, todosOf, toolSummary } from "./tool-summary.js";

/** Tool calls and results as recorded in `packages/daemon/fixtures/stream/<file>`. */
function recorded(file: string) {
  const text = readFileSync(new URL(`../../../daemon/fixtures/stream/${file}`, import.meta.url), "utf8");
  const calls = new Map<string, { name: string; input: Record<string, unknown> }>();
  const results = new Map<string, { text: string; isError: boolean }>();
  for (const line of text.split("\n").filter(Boolean)) {
    const content = JSON.parse(line).message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b.type === "tool_use") calls.set(b.id, { name: b.name, input: b.input });
      if (b.type === "tool_result") {
        const t = typeof b.content === "string" ? b.content : b.content.map((c: { text?: string }) => c.text ?? "").join("\n");
        results.set(b.tool_use_id, { text: t, isError: b.is_error === true });
      }
    }
  }
  return { calls, results };
}

const subagent = recorded("subagent.jsonl");
const call = (id: string) => subagent.calls.get(id)!;

describe("toolSummary", () => {
  describe("Bash, recorded", () => {
    it("joins the lines of a script and leaves out a leading cd", () => {
      const c = call("toolu_01YXwWZYo48TNXd3e9ZLwTNE");
      expect(c.input.command).toMatch(/^cd \/tmp 2>\/dev\/null; for r/);
      const s = toolSummary("Bash", c.input);
      expect(s.startsWith("for r in actions/checkout actions/setup-node pnpm/action-setup; do echo")).toBe(true);
      expect(s).toHaveLength(120);
    });

    it("leaves out a heredoc body", () => {
      const c = call("toolu_01RL4qBdGHuC3sh1d7wDRotu");
      const s = toolSummary("Bash", c.input);
      expect(s.startsWith("git status --short; git add .github/workflows && git commit -q -F - <<'EOF'; git show --stat")).toBe(true);
      expect(s).not.toContain("GitHub warns");
    });

    it("joins the remaining lines of a multi-line command", () => {
      const c = call("toolu_016toivtXeAa2JxzKirSN82K");
      expect(c.input.command).toContain("\n");
      const s = toolSummary("Bash", c.input);
      expect(s).not.toContain("\n");
      expect(s.startsWith("sed -i '' -e 's#actions/checkout@v4#actions/checkout@v7#'")).toBe(true);
    });

    it("uses the description for the step headline when there is one, the command otherwise", () => {
      expect(stepSummary("Bash", call("toolu_018X5yDEYZx819Rr9dCJYsTo").input)).toBe("Verify commit and action versions");
      expect(stepSummary("Bash", call("toolu_01WbnjGKHNw4xPTG1qwbMX4e").input)).toBe(
        'pnpm install --frozen-lockfile --store-dir "$TMPDIR/pstore" 2>&1 | tail -6',
      );
      // Asks and grants keep the command.
      expect(toolSummary("Bash", call("toolu_018X5yDEYZx819Rr9dCJYsTo").input)).toMatch(/^git log --oneline -2 && /);
    });
  });

  describe("Bash", () => {
    it("skips cd, set -e and assignments", () => {
      expect(bashSummary("cd /w && pnpm test")).toBe("pnpm test");
      expect(bashSummary("set -euo pipefail\nROOT=$(pwd)\nexport X=1\ncd \"$ROOT\"\npnpm build\npnpm test\n")).toBe("pnpm build; pnpm test");
      expect(bashSummary("FOO=1 pnpm test")).toBe("FOO=1 pnpm test");
      expect(bashSummary("# build\npnpm build \\\n  --filter web")).toBe("pnpm build --filter web");
    });

    it("keeps the command when it only sets things up", () => {
      expect(bashSummary("cd /w")).toBe("cd /w");
    });
  });

  it("shows file tools relative to the worktree, Read with its line range", () => {
    expect(toolSummary("Read", { file_path: "/w/src/a.ts" }, "/w")).toBe("src/a.ts");
    expect(toolSummary("Read", { file_path: "/w/src/a.ts", offset: 10, limit: 50 }, "/w")).toBe("src/a.ts:10-59");
    expect(toolSummary("Read", { file_path: "/w/a.ts", limit: 20 }, "/w/")).toBe("a.ts:1-20");
    expect(toolSummary("Read", { file_path: "/w/a.ts", offset: 30 })).toBe("/w/a.ts:30-");
    expect(toolSummary("Edit", { file_path: "/w/src/a.ts", old_string: "a", new_string: "b" }, "/w")).toBe("src/a.ts");
    expect(toolSummary("Write", { file_path: "/elsewhere/a.ts", content: "" }, "/w")).toBe("/elsewhere/a.ts");
  });

  it("shows Read and Write from a recorded run", () => {
    const basic = recorded("basic.jsonl");
    const [read, write] = [...basic.calls.values()];
    expect(toolSummary(read!.name, read!.input, "/tmp/donepm-fixture")).toBe("a.txt");
    expect(toolSummary(write!.name, write!.input, "/tmp/donepm-fixture")).toBe("b.txt");
  });

  it("shows pattern and path of search tools", () => {
    expect(toolSummary("Grep", { pattern: "TODO" })).toBe("TODO");
    expect(toolSummary("Grep", { pattern: "TODO", path: "/w/src", glob: "*.ts" }, "/w")).toBe("TODO in src (*.ts)");
    expect(toolSummary("Glob", { pattern: "**/*.vue", path: "/w" }, "/w")).toBe("**/*.vue");
  });

  it("shows host and path of WebFetch in a step, the full URL in asks", () => {
    expect(stepSummary("WebFetch", call("toolu_01StoArRhE3DzanW9XzKeMSv").input)).toBe("github.com/actions/checkout/releases");
    expect(stepSummary("WebFetch", { url: "https://example.com/?q=1" })).toBe("example.com");
    expect(stepSummary("WebFetch", { url: "not a url" })).toBe("not a url");
    expect(toolSummary("WebFetch", { url: "https://example.com/a?q=1" })).toBe("https://example.com/a?q=1");
  });

  it("shows subagent type and description", () => {
    expect(toolSummary("Agent", { description: "Find the bug", subagent_type: "Explore", prompt: "…" })).toBe("Explore: Find the bug");
    expect(toolSummary("Agent", call("toolu_01SBL4PYXe8HB6joVkWLMHdi").input)).toBe("Bump GitHub Actions to Node 24");
  });

  it("shows the todo in progress", () => {
    const todos = [
      { content: "Read code", activeForm: "Reading code", status: "completed" },
      { content: "Write tests", activeForm: "Writing tests", status: "in_progress" },
      { content: "Open PR", activeForm: "Opening PR", status: "pending" },
    ];
    expect(toolSummary("TodoWrite", { todos })).toBe("Writing tests");
    expect(toolSummary("TodoWrite", { todos: todos.map((t) => ({ ...t, status: "completed" })) })).toBe("all 3 done");
    expect(toolSummary("TodoWrite", { todos: [todos[0], todos[2]] })).toBe("1/2 done");
    expect(toolSummary("TodoWrite", { todos: [{}, {}] })).toBe("2 todos");
    expect(todosOf({ todos: [todos[1], { status: "pending" }, null] })).toEqual([todos[1]]);
  });

  it("shows questions", () => {
    expect(toolSummary("AskUserQuestion", { questions: [{ question: "Which color?" }, { question: "Which size?" }] })).toBe("Which color? (+1 more)");
    expect(toolSummary("AskUserQuestion", { questions: [{ question: "Which color?" }] })).toBe("Which color?");
    expect(toolSummary("AskUserQuestion", { questions: [] })).toBe("");
  });

  it("falls back to the first string for unknown tools", () => {
    expect(toolSummary("mcp__donepm__draft_pr", { draft: 1, title: "Fix the bug" })).toBe("Fix the bug");
    expect(toolSummary("ToolSearch", call("toolu_0158sDDcgYuFibj8dvvzgQvV").input)).toBe("select:WebFetch,WebSearch");
    expect(toolSummary("SandboxNetworkAccess", { port: "443", host: "example.com" })).toBe("example.com");
  });

  it("cuts long values", () => {
    const s = toolSummary("Bash", { command: "x".repeat(300) });
    expect(s).toHaveLength(120);
    expect(s.endsWith("…")).toBe(true);
  });

  it("strips escape codes", () => {
    const command = "\u001b[32mecho\u001b[39m hi\u001b]8;;http://x\u0007 link\u001b]8;;\u0007";
    expect(toolSummary("Bash", { command })).toBe("echo hi link");
  });

  it("is empty for odd input", () => {
    expect(toolSummary("Bash", null)).toBe("");
    expect(toolSummary("Foo", { n: 1 })).toBe("");
    expect(stepSummary("Bash", { command: "ls", description: " " })).toBe("ls");
  });
});

describe("relativePath", () => {
  it("only strips the worktree itself", () => {
    expect(relativePath("/w/a", "/w")).toBe("a");
    expect(relativePath("/w", "/w")).toBe(".");
    expect(relativePath("/wx/a", "/w")).toBe("/wx/a");
    expect(relativePath("/w/a")).toBe("/w/a");
  });
});

describe("resultNote", () => {
  it("shows the exit code of a failed command, recorded", () => {
    const r = subagent.results.get("toolu_0184LLgiEjdcKskGiD8ajQCR")!;
    expect(resultNote("Bash", r.text, r.isError)).toBe("exit 1");
  });

  it("shows a denied call, recorded", () => {
    const deny = recorded("deny-gh.jsonl");
    const [r] = [...deny.results.values()];
    expect(resultNote("Bash", r!.text, r!.isError)).toBe("denied");
  });

  it("counts lines of a recorded result and shows short ones", () => {
    const r = subagent.results.get("toolu_01SHnWGShXMhk3Sy2aJZctRN")!;
    expect(resultNote("Bash", r.text, r.isError)).toMatch(/^\d+ lines$/);
    expect(resultNote("Bash", "200", false)).toBe("200");
    expect(resultNote("Bash", "", false)).toBe("done");
    expect(resultNote("Bash", "x".repeat(60), false)).toHaveLength(40);
    expect(resultNote("Edit", "<tool_use_error>File has not been read yet</tool_use_error>", true)).toBe("error");
  });

  it("shows test counts", () => {
    const vitest = " Test Files  3 passed (3)\n      Tests  \u001b[1m\u001b[32m41 passed\u001b[39m\u001b[22m (41)\n   Start at  12:00:00\n   Duration  1.2s\n";
    expect(resultNote("Bash", vitest, false)).toBe("41 passed");
    expect(resultNote("Bash", "Exit code 1\n Tests  2 failed | 39 passed (41)\n", true)).toBe("exit 1 · 2 failed · 39 passed");
    expect(resultNote("Read", vitest, false)).toBe("4 lines");
  });

  it("counts files of search tools", () => {
    expect(resultNote("Grep", "Found 3 files\na.ts\nb.ts\nc.ts", false)).toBe("3 files");
    expect(resultNote("Grep", "No files found", false)).toBe("no matches");
    expect(resultNote("Glob", "/w/a.ts\n/w/b.ts\n", false)).toBe("2 files");
    expect(resultNote("Glob", "/w/a.ts", false)).toBe("1 file");
  });
});

describe("testCounts", () => {
  it("reads common runners", () => {
    expect(testCounts("Tests:       1 failed, 11 passed, 12 total")).toEqual({ passed: 11, failed: 1 });
    expect(testCounts("===== 3 failed, 10 passed in 0.52s =====")).toEqual({ passed: 10, failed: 3 });
    expect(testCounts("test result: ok. 12 passed; 0 failed; 0 ignored")).toEqual({ passed: 12, failed: 0 });
    expect(testCounts("OK (12 tests, 30 assertions)")).toEqual({ passed: 12, failed: 0 });
    expect(testCounts("FAILURES!\nTests: 12, Assertions: 30, Failures: 2.")).toEqual({ passed: 10, failed: 2 });
    expect(testCounts("all good")).toBeUndefined();
  });
});
