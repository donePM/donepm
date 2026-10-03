// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../markdown/render";
import { rendersMarkdown } from "./markdown";
import type { Row } from "./rows";

describe("rendersMarkdown", () => {
  it("renders the agent's text and the task", () => {
    expect(rendersMarkdown({ type: "text", id: "t", text: "**hi**" })).toBe(true);
    expect(rendersMarkdown({ type: "task", id: "k", text: "# Task" })).toBe(true);
  });

  it("keeps everything else plain", () => {
    const plain: Row[] = [
      { type: "user", id: "u", text: "**hi**" },
      { type: "thinking", id: "th", text: "**hi**" },
      { type: "setup", id: "s", label: "pnpm install", ok: true, output: "" },
      { type: "tool", id: "to", at: "2026-10-03T00:00:00Z", name: "Bash", summary: "ls", input: {} },
      { type: "ask", id: "a", name: "Bash", summary: "ls" },
      { type: "result", id: "r", ok: true, label: "done" },
    ];
    for (const row of plain) expect(rendersMarkdown(row)).toBe(false);
  });
});

describe("agent text while it streams", () => {
  it("renders an open code fence as code up to the end", () => {
    const out = renderMarkdown("Here:\n\n```ts\nconst a = 1;");
    expect(out).toContain('<pre><code class="language-ts">const a = 1;</code></pre>');
  });

  it("sanitizes what the agent writes", () => {
    const out = renderMarkdown('Done. <img src=x onerror="alert(1)"> [x](javascript:alert(1))');
    const div = document.createElement("div");
    div.innerHTML = out;
    expect(div.querySelector("img")).toBeNull();
    expect(div.querySelector("a[href]")).toBeNull();
  });
});
