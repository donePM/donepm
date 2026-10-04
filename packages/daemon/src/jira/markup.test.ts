import { describe, expect, it } from "vitest";
import { jiraBody } from "./markup.js";

describe("jiraBody (issue #139)", () => {
  it("turns Markdown into Atlassian Document Format for Cloud", () => {
    expect(jiraBody("Hello **world**", "3")).toEqual({
      version: 1,
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello " }, { type: "text", text: "world", marks: [{ type: "strong" }] }] }],
    });
  });

  it("turns Markdown into wiki markup for Data Center", () => {
    expect(jiraBody("Hello **world**, see `x`.\n\n1. one\n2. [two](https://acme.com)", "2")).toBe(
      "Hello *world*, see {{x}}.\n\n# one\n# [two|https://acme.com]",
    );
  });
});
